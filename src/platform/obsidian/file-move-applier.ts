import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView, TFile } from 'obsidian';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import type { DocLikeWithRange } from '../../domain/markdown/document-types';
import { getCodeMirrorView } from './editor-view';
import type { BlockSelection } from '../../domain/selection/block-selection';
import { captureMoveSourcePayload, type MoveSourcePayload } from '../../domain/transaction/move-blocks';
import type { TextChange } from '../../domain/transaction/block-transaction';
import { planOrderedListRenumberChanges } from '../../domain/transaction/list-renumber';
import { applyBlockTransaction } from '../codemirror/transaction/transaction-applier';

type MarkdownViewWithFile = MarkdownView & {
    file?: TFile | null;
};

export type FileMoveResult = {
    moved: boolean;
    reason?: string;
};

export class FileMoveApplier {
    constructor(private readonly app: App) { }

    async applyFileMove(params: {
        sourceView: EditorView;
        selection: BlockSelection;
        targetFile: TFile;
    }): Promise<FileMoveResult> {
        const { sourceView, selection, targetFile } = params;
        if (targetFile.extension !== 'md') {
            return { moved: false, reason: 'target_not_markdown' };
        }

        const payload = captureMoveSourcePayload(sourceView.state.doc, selection);
        if (!payload || payload.content.length === 0) {
            return { moved: false, reason: 'empty_source' };
        }

        const targetView = this.getOpenMarkdownEditorView(targetFile);
        if (targetView === sourceView) {
            this.moveWithinSameEditorToEnd(sourceView, payload);
            this.renumberSourceLists(sourceView, payload);
            return { moved: true };
        }

        if (targetView) {
            this.appendToEditor(targetView, payload.content);
            this.deleteSourcePayload(sourceView, payload);
            this.renumberSourceLists(sourceView, payload);
            return { moved: true };
        }

        await this.app.vault.process(targetFile, (data) => appendMarkdownBlock(data, payload.content));
        this.deleteSourcePayload(sourceView, payload);
        this.renumberSourceLists(sourceView, payload);
        return { moved: true };
    }

    private getOpenMarkdownEditorView(file: TFile): EditorView | null {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view.getViewType?.() !== 'markdown') continue;
            const markdownView = view as MarkdownViewWithFile;
            if (markdownView.file?.path !== file.path) continue;
            return getCodeMirrorView(markdownView);
        }
        return null;
    }

    private appendToEditor(view: EditorView, content: string): void {
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const insert = buildAppendInsertion(doc.sliceString(0, doc.length), content);
        if (!insert.length) return;
        applyBlockTransaction(view, {
            changes: [{ from: doc.length, to: doc.length, insert }],
        }, { anchor: doc.length });
    }

    private deleteSourcePayload(sourceView: EditorView, payload: MoveSourcePayload): void {
        const changes = this.getMergedDeleteChanges(payload).sort((a, b) => b.from - a.from);
        if (changes.length === 0) return;
        applyBlockTransaction(sourceView, { changes }, { anchor: payload.segments[0]?.deleteFrom ?? 0 });
    }

    private moveWithinSameEditorToEnd(view: EditorView, payload: MoveSourcePayload): void {
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const deletes = this.getMergedDeleteChanges(payload);
        const remainingText = applyDeleteChanges(doc.sliceString(0, doc.length), deletes);
        const insert = buildAppendInsertion(remainingText, payload.content);
        const changes: TextChange[] = [
            ...deletes,
            ...(insert.length ? [{ from: doc.length, to: doc.length, insert }] : []),
        ].sort((a, b) => b.from - a.from);
        if (changes.length === 0) return;
        applyBlockTransaction(view, { changes }, { anchor: payload.segments[0]?.deleteFrom ?? 0 });
    }

    private getMergedDeleteChanges(payload: MoveSourcePayload): TextChange[] {
        const sorted = payload.segments
            .map((segment) => ({
                from: segment.deleteFrom,
                to: segment.deleteTo,
            }))
            .sort((a, b) => a.from - b.from);

        const merged: TextChange[] = [];
        for (const change of sorted) {
            const last = merged[merged.length - 1];
            if (!last) {
                merged.push({ ...change, insert: '' });
                continue;
            }
            if (change.from <= last.to) {
                last.to = Math.max(last.to, change.to);
                continue;
            }
            merged.push({ ...change, insert: '' });
        }
        return merged;
    }

    private renumberSourceLists(sourceView: EditorView, payload: MoveSourcePayload): void {
        const lineParsing = createLineParsingContext(sourceView.state.facet(EditorState.tabSize));
        const lineNumbers = new Set(payload.segments.map((segment) => segment.startLineNumber));
        for (const lineNumber of lineNumbers) {
            const changes = planOrderedListRenumberChanges(
                sourceView.state.doc,
                (line) => lineParsing.parseLine(line),
                lineNumber
            );
            applyBlockTransaction(sourceView, { changes });
        }
    }
}

export function appendMarkdownBlock(existing: string, blockContent: string): string {
    const insert = buildAppendInsertion(existing, blockContent);
    return insert.length ? `${existing}${insert}` : existing;
}

function buildAppendInsertion(existing: string, blockContent: string): string {
    const normalized = blockContent.replace(/\n+$/, '');
    if (!normalized.length) return '';
    if (!existing.length) return normalized;
    if (existing.endsWith('\n\n')) return normalized;
    if (existing.endsWith('\n')) return `\n${normalized}`;
    return `\n\n${normalized}`;
}

function applyDeleteChanges(existing: string, deletes: TextChange[]): string {
    let result = '';
    let cursor = 0;
    for (const change of deletes) {
        result += existing.slice(cursor, change.from);
        cursor = change.to;
    }
    return result + existing.slice(cursor);
}
