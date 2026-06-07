import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { detectBlock } from '../domain/block/block-detector';
import { resolveDeleteRange } from '../drag/move/document-change';
import { anchorSelectionBeforeUndoableChange } from '../platform/codemirror/undo-selection-anchor';

export type BlockTypeConversion =
    | 'paragraph'
    | 'heading-1'
    | 'heading-2'
    | 'heading-3'
    | 'bullet-list'
    | 'ordered-list'
    | 'task-list'
    | 'blockquote'
    | 'code-block';

export const BLOCK_TYPE_CONVERSION_OPTIONS: Array<{ id: BlockTypeConversion; label: string; icon: string }> = [
    { id: 'paragraph', label: 'Paragraph', icon: 'pilcrow' },
    { id: 'heading-1', label: 'Heading 1', icon: 'heading-1' },
    { id: 'heading-2', label: 'Heading 2', icon: 'heading-2' },
    { id: 'heading-3', label: 'Heading 3', icon: 'heading-3' },
    { id: 'bullet-list', label: 'Bullet list', icon: 'list' },
    { id: 'ordered-list', label: 'Ordered list', icon: 'list-ordered' },
    { id: 'task-list', label: 'Task list', icon: 'list-checks' },
    { id: 'blockquote', label: 'Quote', icon: 'quote' },
    { id: 'code-block', label: 'Code block', icon: 'code' },
];

type LineChange = {
    from: number;
    to: number;
    insert: string;
};

export function convertCurrentBlockType(view: EditorView, conversion: BlockTypeConversion): boolean {
    const block = getCurrentBlock(view);
    if (!block) return false;

    const changes = buildBlockTypeConversionChanges(view.state, block.startLine + 1, block.endLine + 1, conversion);
    if (changes.length === 0) return false;

    view.dispatch({
        changes,
        scrollIntoView: false,
    });
    return true;
}

export function deleteCurrentBlock(view: EditorView): boolean {
    const block = getCurrentBlock(view);
    if (!block) return false;

    const startLine = view.state.doc.line(block.startLine + 1);
    const endLine = view.state.doc.line(block.endLine + 1);
    const change = resolveDeleteRange(view.state.doc, startLine.from, endLine.to);
    if (change.from === change.to) return false;

    anchorSelectionBeforeUndoableChange(view, change.from);
    view.dispatch({
        changes: { from: change.from, to: change.to },
        scrollIntoView: false,
    });
    return true;
}

function getCurrentBlock(view: EditorView): { startLine: number; endLine: number } | null {
    const head = view.state.selection.main.head;
    const lineNumber = view.state.doc.lineAt(head).number;
    const block = detectBlock(view.state, lineNumber);
    if (!block) return { startLine: lineNumber - 1, endLine: lineNumber - 1 };
    return { startLine: block.startLine, endLine: block.endLine };
}

function buildBlockTypeConversionChanges(
    state: EditorState,
    startLineNumber: number,
    endLineNumber: number,
    conversion: BlockTypeConversion
): LineChange[] {
    if (conversion === 'code-block') {
        return buildCodeBlockChanges(state, startLineNumber, endLineNumber);
    }

    const changes: LineChange[] = [];
    for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
        const line = state.doc.line(lineNumber);
        const next = convertLine(line.text, conversion, lineNumber - startLineNumber + 1);
        if (next === line.text) continue;
        changes.push({ from: line.from, to: line.to, insert: next });
    }
    return changes;
}

function buildCodeBlockChanges(state: EditorState, startLineNumber: number, endLineNumber: number): LineChange[] {
    const startLine = state.doc.line(startLineNumber);
    const endLine = state.doc.line(endLineNumber);
    const content = state.doc.sliceString(startLine.from, endLine.to);
    if (content.startsWith('```') && content.endsWith('```')) return [];
    return [{ from: startLine.from, to: endLine.to, insert: `\`\`\`\n${content}\n\`\`\`` }];
}

function convertLine(text: string, conversion: Exclude<BlockTypeConversion, 'code-block'>, ordinal: number): string {
    const { quotePrefix, indentRaw, body } = stripKnownBlockPrefix(text);
    switch (conversion) {
        case 'paragraph':
            return `${quotePrefix}${indentRaw}${body}`;
        case 'heading-1':
            return `${quotePrefix}${indentRaw}# ${body}`;
        case 'heading-2':
            return `${quotePrefix}${indentRaw}## ${body}`;
        case 'heading-3':
            return `${quotePrefix}${indentRaw}### ${body}`;
        case 'bullet-list':
            return `${quotePrefix}${indentRaw}- ${body}`;
        case 'ordered-list':
            return `${quotePrefix}${indentRaw}${ordinal}. ${body}`;
        case 'task-list':
            return `${quotePrefix}${indentRaw}- [ ] ${body}`;
        case 'blockquote':
            return `> ${indentRaw}${body}`;
    }
}

function stripKnownBlockPrefix(text: string): { quotePrefix: string; indentRaw: string; body: string } {
    const quoteMatch = text.match(/^(\s*>\s?)*/);
    const quotePrefix = quoteMatch?.[0] ?? '';
    const withoutQuote = text.slice(quotePrefix.length);
    const indentMatch = withoutQuote.match(/^(\s*)/);
    const indentRaw = indentMatch?.[0] ?? '';
    let rest = withoutQuote.slice(indentRaw.length);

    rest = rest.replace(/^#{1,6}\s+/, '');
    const listMatch = rest.match(/^((?:[-*+]\s\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))/);
    if (listMatch) {
        rest = rest.slice(listMatch[0].length);
    }
    return { quotePrefix, indentRaw, body: rest };
}
