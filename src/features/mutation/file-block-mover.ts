import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView, TFile } from 'obsidian';
import { BlockInfo } from '../../core/block/block-types';
import { LineParsingService } from '../../core/parser/line-parsing-service';
import { DocLikeWithRange } from '../../shared/types/protocol-types';
import { normalizeCompositeRanges } from '../../shared/utils/composite-selection';
import { getCodeMirrorView } from '../../platform/obsidian/editor-view';
import { ListRenumberer } from './list-renumberer';

type SourceSegment = {
    startLineNumber: number;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

type SourcePayload = {
    content: string;
    segments: SourceSegment[];
};

type MarkdownViewWithFile = MarkdownView & {
    file?: TFile | null;
};

export type FileBlockMoveResult = {
    moved: boolean;
    reason?: string;
};

export class FileBlockMover {
    constructor(private readonly app: App) { }

    async moveBlockToFile(params: {
        sourceView: EditorView;
        sourceBlock: BlockInfo;
        targetFile: TFile;
    }): Promise<FileBlockMoveResult> {
        const { sourceView, sourceBlock, targetFile } = params;
        if (targetFile.extension !== 'md') {
            return { moved: false, reason: 'target_not_markdown' };
        }

        const payload = this.captureSourcePayload(sourceView, sourceBlock);
        if (!payload || payload.content.length === 0) {
            return { moved: false, reason: 'empty_source' };
        }

        const targetView = this.getOpenMarkdownEditorView(targetFile);
        if (targetView === sourceView) {
            this.deleteSourcePayload(sourceView, payload);
            this.appendToEditor(targetView, payload.content);
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

    private captureSourcePayload(sourceView: EditorView, sourceBlock: BlockInfo): SourcePayload | null {
        const doc = sourceView.state.doc as unknown as DocLikeWithRange;
        const rawRanges = sourceBlock.compositeSelection?.ranges ?? [{
            startLine: sourceBlock.startLine,
            endLine: sourceBlock.endLine,
        }];
        const ranges = normalizeCompositeRanges(rawRanges, doc.lines);
        if (ranges.length === 0) return null;

        const segments = ranges.map((range) => {
            const startLineNumber = range.startLine + 1;
            const endLineNumber = range.endLine + 1;
            const startLine = doc.line(startLineNumber);
            const endLine = doc.line(endLineNumber);
            const deleteRange = resolveDeleteRange(doc, startLine.from, endLine.to);
            return {
                startLineNumber,
                from: startLine.from,
                to: endLine.to,
                deleteFrom: deleteRange.from,
                deleteTo: deleteRange.to,
            };
        });
        const content = segments
            .map((segment) => doc.sliceString(segment.from, segment.to))
            .join('\n');

        return { content, segments };
    }

    private appendToEditor(view: EditorView, content: string): void {
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const insert = buildAppendInsertion(doc.sliceString(0, doc.length), content);
        if (!insert.length) return;
        view.dispatch({
            changes: { from: doc.length, to: doc.length, insert },
            scrollIntoView: false,
        });
    }

    private deleteSourcePayload(sourceView: EditorView, payload: SourcePayload): void {
        const changes = payload.segments
            .map((segment) => ({
                from: segment.deleteFrom,
                to: segment.deleteTo,
            }))
            .sort((a, b) => b.from - a.from);
        if (changes.length === 0) return;
        sourceView.dispatch({
            changes,
            scrollIntoView: false,
        });
    }

    private renumberSourceLists(sourceView: EditorView, payload: SourcePayload): void {
        const lineParsing = new LineParsingService(sourceView);
        const renumberer = new ListRenumberer({
            view: sourceView,
            parseLineWithQuote: (line) => lineParsing.parseLine(line),
        });
        const lineNumbers = new Set(payload.segments.map((segment) => segment.startLineNumber));
        for (const lineNumber of lineNumbers) {
            renumberer.renumberOrderedListAround(lineNumber);
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

function resolveDeleteRange(
    doc: DocLikeWithRange,
    sourceFrom: number,
    sourceTo: number
): { from: number; to: number } {
    if (sourceTo < doc.length) {
        return {
            from: sourceFrom,
            to: Math.min(sourceTo + 1, doc.length),
        };
    }

    if (sourceFrom > 0) {
        return {
            from: sourceFrom - 1,
            to: sourceTo,
        };
    }

    return {
        from: sourceFrom,
        to: sourceTo,
    };
}
