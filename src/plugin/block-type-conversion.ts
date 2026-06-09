import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { detectBlock } from '../domain/block/block-detector';
import { BlockType, type BlockInfo } from '../domain/block/block-types';
import { createDeleteCommand } from '../domain/command/delete-command';
import { createBlockSelection } from '../domain/selection/block-selection';
import { planBlockCommandTransaction } from '../domain/transaction/block-command-transaction';
import { applyBlockTransaction } from '../platform/codemirror/transaction/transaction-applier';
import type { CommandReject } from '../domain/transaction/command-reject';

export type BlockTypeConversion =
    | 'paragraph'
    | 'heading-1'
    | 'heading-2'
    | 'heading-3'
    | 'heading-4'
    | 'heading-5'
    | 'heading-6'
    | 'bullet-list'
    | 'ordered-list'
    | 'task-list'
    | 'blockquote'
    | 'code-block';

export type BlockTypeConversionOption = { id: BlockTypeConversion; label: string; icon: string };

export const PARAGRAPH_BLOCK_TYPE_OPTION: BlockTypeConversionOption = { id: 'paragraph', label: 'Paragraph', icon: 'pilcrow' };

export const HEADING_BLOCK_TYPE_OPTIONS: BlockTypeConversionOption[] = [
    { id: 'heading-1', label: 'Heading 1', icon: 'heading-1' },
    { id: 'heading-2', label: 'Heading 2', icon: 'heading-2' },
    { id: 'heading-3', label: 'Heading 3', icon: 'heading-3' },
    { id: 'heading-4', label: 'Heading 4', icon: 'heading-4' },
    { id: 'heading-5', label: 'Heading 5', icon: 'heading-5' },
    { id: 'heading-6', label: 'Heading 6', icon: 'heading-6' },
];

export const LIST_BLOCK_TYPE_OPTIONS: BlockTypeConversionOption[] = [
    { id: 'bullet-list', label: 'Bullet list', icon: 'list' },
    { id: 'ordered-list', label: 'Numbered list', icon: 'list-ordered' },
    { id: 'task-list', label: 'Task list', icon: 'list-checks' },
];

export const SIMPLE_BLOCK_TYPE_OPTIONS: BlockTypeConversionOption[] = [
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

    const transaction = planBlockCommandTransaction({
        doc: view.state.doc,
        command: createDeleteCommand(createBlockSelection(block, [{
            startLine: block.startLine,
            endLine: block.endLine,
        }])),
    });
    if (isCommandReject(transaction)) return false;
    applyBlockTransaction(view, transaction, { anchor: block.from });
    return true;
}

export async function copyCurrentBlock(view: EditorView): Promise<boolean> {
    const text = getCurrentBlockText(view);
    if (text === null) return false;
    return writeClipboardText(text);
}

export async function cutCurrentBlock(view: EditorView): Promise<boolean> {
    const copied = await copyCurrentBlock(view);
    if (!copied) return false;
    return deleteCurrentBlock(view);
}

function getCurrentBlockText(view: EditorView): string | null {
    const block = getCurrentBlock(view);
    if (!block) return null;
    return view.state.doc.sliceString(block.from, block.to);
}

async function writeClipboardText(text: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

function getCurrentBlock(view: EditorView): BlockInfo | null {
    const head = view.state.selection.main.head;
    const lineNumber = view.state.doc.lineAt(head).number;
    const block = detectBlock(view.state, lineNumber, { tabSize: view.state.facet(EditorState.tabSize) });
    if (block) return block;
    const line = view.state.doc.line(lineNumber);
    return {
        type: BlockType.Paragraph,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        indentLevel: 0,
        content: line.text,
    };
}

function isCommandReject(value: unknown): value is CommandReject {
    return typeof value === 'object'
        && value !== null
        && 'type' in value
        && value.type === 'reject';
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
    const content = Array.from({ length: endLineNumber - startLineNumber + 1 }, (_, index) => {
        const line = state.doc.line(startLineNumber + index);
        return stripKnownBlockPrefix(line.text).body;
    }).join('\n');
    if (content.startsWith('```') && content.endsWith('```')) return [];
    return [{ from: startLine.from, to: endLine.to, insert: `\`\`\`\n${content}\n\`\`\`` }];
}

function convertLine(text: string, conversion: Exclude<BlockTypeConversion, 'code-block'>, ordinal: number): string {
    const { indentRaw, body } = stripKnownBlockPrefix(text);
    switch (conversion) {
        case 'paragraph':
            return `${indentRaw}${body}`;
        case 'heading-1':
            return `${indentRaw}# ${body}`;
        case 'heading-2':
            return `${indentRaw}## ${body}`;
        case 'heading-3':
            return `${indentRaw}### ${body}`;
        case 'heading-4':
            return `${indentRaw}#### ${body}`;
        case 'heading-5':
            return `${indentRaw}##### ${body}`;
        case 'heading-6':
            return `${indentRaw}###### ${body}`;
        case 'bullet-list':
            return `${indentRaw}- ${body}`;
        case 'ordered-list':
            return `${indentRaw}${ordinal}. ${body}`;
        case 'task-list':
            return `${indentRaw}- [ ] ${body}`;
        case 'blockquote':
            return `> ${indentRaw}${body}`;
    }
}

function stripKnownBlockPrefix(text: string): { indentRaw: string; body: string } {
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
    return { indentRaw, body: rest };
}
