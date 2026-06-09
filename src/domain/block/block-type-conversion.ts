import type { DocLikeWithRange, MarkerType } from '../markdown/document-types';
import { isCodeFenceLine } from './block-guards';
import { BlockType } from './block-types';

export type BlockTypeConversion =
    | { type: BlockType.Paragraph }
    | { type: BlockType.Heading; level: 1 | 2 | 3 | 4 | 5 | 6 }
    | { type: BlockType.ListItem; markerType: MarkerType }
    | { type: BlockType.Blockquote }
    | { type: BlockType.CodeBlock };

export type BlockTypeConversionChange = {
    from: number;
    to: number;
    insert: string;
};

export function planBlockTypeConversionChanges(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number,
    conversion: BlockTypeConversion
): BlockTypeConversionChange[] {
    if (conversion.type === BlockType.CodeBlock) {
        return planCodeBlockChanges(doc, startLineNumber, endLineNumber);
    }

    const codeContentLines = readCodeBlockContentLines(doc, startLineNumber, endLineNumber);
    if (codeContentLines) {
        return planCodeBlockUnwrapChanges(doc, startLineNumber, endLineNumber, codeContentLines, conversion);
    }

    const changes: BlockTypeConversionChange[] = [];
    for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
        const line = doc.line(lineNumber);
        const next = convertLine(line.text, conversion, lineNumber - startLineNumber + 1);
        if (next === line.text) continue;
        changes.push({ from: line.from, to: line.to, insert: next });
    }
    return changes;
}

function readCodeBlockContentLines(doc: DocLikeWithRange, startLineNumber: number, endLineNumber: number): string[] | null {
    if (startLineNumber >= endLineNumber) return null;
    if (!isCodeFenceLine(doc.line(startLineNumber).text)) return null;
    if (!isCodeFenceLine(doc.line(endLineNumber).text)) return null;
    return Array.from({ length: endLineNumber - startLineNumber - 1 }, (_, index) => (
        doc.line(startLineNumber + index + 1).text
    ));
}

function planCodeBlockUnwrapChanges(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number,
    contentLines: string[],
    conversion: Exclude<BlockTypeConversion, { type: BlockType.CodeBlock }>
): BlockTypeConversionChange[] {
    const startLine = doc.line(startLineNumber);
    const endLine = doc.line(endLineNumber);
    const insert = contentLines
        .map((line, index) => convertCodeContentLine(line, conversion, index + 1))
        .join('\n');
    return [{ from: startLine.from, to: endLine.to, insert }];
}

function planCodeBlockChanges(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number
): BlockTypeConversionChange[] {
    const startLine = doc.line(startLineNumber);
    const endLine = doc.line(endLineNumber);
    const content = Array.from({ length: endLineNumber - startLineNumber + 1 }, (_, index) => {
        const line = doc.line(startLineNumber + index);
        return stripKnownBlockPrefix(line.text).body;
    }).join('\n');
    if (content.startsWith('```') && content.endsWith('```')) return [];
    return [{ from: startLine.from, to: endLine.to, insert: `\`\`\`\n${content}\n\`\`\`` }];
}

function convertLine(text: string, conversion: Exclude<BlockTypeConversion, { type: BlockType.CodeBlock }>, ordinal: number): string {
    const { indentRaw, body } = stripKnownBlockPrefix(text);
    return formatConvertedLine(indentRaw, body, conversion, ordinal);
}

function convertCodeContentLine(text: string, conversion: Exclude<BlockTypeConversion, { type: BlockType.CodeBlock }>, ordinal: number): string {
    const { indentRaw, body } = splitIndent(text);
    return formatConvertedLine(indentRaw, body, conversion, ordinal);
}

function formatConvertedLine(
    indentRaw: string,
    body: string,
    conversion: Exclude<BlockTypeConversion, { type: BlockType.CodeBlock }>,
    ordinal: number
): string {
    switch (conversion.type) {
        case BlockType.Paragraph:
            return `${indentRaw}${body}`;
        case BlockType.Heading:
            return `${indentRaw}${'#'.repeat(conversion.level)} ${body}`;
        case BlockType.ListItem:
            return `${indentRaw}${formatListMarker(conversion.markerType, ordinal)}${body}`;
        case BlockType.Blockquote:
            return `> ${indentRaw}${body}`;
    }
}

function formatListMarker(markerType: MarkerType, ordinal: number): string {
    switch (markerType) {
        case 'ordered':
            return `${ordinal}. `;
        case 'task':
            return '- [ ] ';
        case 'unordered':
            return '- ';
    }
}

function stripKnownBlockPrefix(text: string): { indentRaw: string; body: string } {
    const quoteMatch = text.match(/^(\s*>\s?)*/);
    const quotePrefix = quoteMatch?.[0] ?? '';
    const withoutQuote = text.slice(quotePrefix.length);
    const { indentRaw, body } = splitIndent(withoutQuote);
    let rest = body;

    rest = rest.replace(/^#{1,6}\s+/, '');
    const listMatch = rest.match(/^((?:[-*+]\s\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))/);
    if (listMatch) {
        rest = rest.slice(listMatch[0].length);
    }
    return { indentRaw, body: rest };
}

function splitIndent(text: string): { indentRaw: string; body: string } {
    const indentMatch = text.match(/^(\s*)/);
    const indentRaw = indentMatch?.[0] ?? '';
    return { indentRaw, body: text.slice(indentRaw.length) };
}
