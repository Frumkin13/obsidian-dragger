// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { createDragSource } from '../../shared/types/drag';
import { appendMarkdownBlock, FileBlockMover } from './file-mover';

type MutableView = EditorView & {
    documentDispatchCount: number;
};

describe('FileBlockMover', () => {
    it('appends a block to a closed target file and deletes it from the source editor', async () => {
        const sourceView = createMutableView('before\nmove me\nafter');
        let targetContent = 'Archive';
        const targetFile = createMarkdownFile('Archive.md');
        const app = createAppStub({
            processFile: async (_file, fn) => {
                targetContent = fn(targetContent);
                return targetContent;
            },
        });

        const result = await new FileBlockMover(app).moveBlockToFile({
            sourceView,
            source: sourceFromBlock(createBlock(1, 1)),
            targetFile,
        });

        expect(result.moved).toBe(true);
        expect(sourceView.state.doc.toString()).toBe('before\nafter');
        expect(targetContent).toBe('Archive\n\nmove me');
    });

    it('moves composite selections into a target file as one appended block', async () => {
        const sourceView = createMutableView('one\ntwo\nthree\nfour');
        let targetContent = '';
        const app = createAppStub({
            processFile: async (_file, fn) => {
                targetContent = fn(targetContent);
                return targetContent;
            },
        });

        const result = await new FileBlockMover(app).moveBlockToFile({
            sourceView,
            source: sourceFromBlock(createBlock(0, 2), [
                { startLine: 0, endLine: 0 },
                { startLine: 2, endLine: 2 },
            ]),
            targetFile: createMarkdownFile('Archive.md'),
        });

        expect(result.moved).toBe(true);
        expect(sourceView.state.doc.toString()).toBe('two\nfour');
        expect(targetContent).toBe('one\nthree');
    });

    it('uses the open target editor when the target file is already open', async () => {
        const sourceView = createMutableView('source\nmove');
        const targetView = createMutableView('target');
        const targetFile = createMarkdownFile('Archive.md');
        const processFile = vi.fn();
        const app = createAppStub({
            leaves: [createMarkdownLeaf(targetFile, targetView)],
            processFile,
        });

        const result = await new FileBlockMover(app).moveBlockToFile({
            sourceView,
            source: sourceFromBlock(createBlock(1, 1)),
            targetFile,
        });

        expect(result.moved).toBe(true);
        expect(processFile).not.toHaveBeenCalled();
        expect(sourceView.state.doc.toString()).toBe('source');
        expect(targetView.state.doc.toString()).toBe('target\n\nmove');
    });

    it('can move a block to the end of its own file', async () => {
        const targetFile = createMarkdownFile('Daily.md');
        const sourceView = createMutableView('keep\nmove');
        const app = createAppStub({
            leaves: [createMarkdownLeaf(targetFile, sourceView)],
        });

        const result = await new FileBlockMover(app).moveBlockToFile({
            sourceView,
            source: sourceFromBlock(createBlock(1, 1)),
            targetFile,
        });

        expect(result.moved).toBe(true);
        expect(sourceView.state.doc.toString()).toBe('keep\n\nmove');
        expect(sourceView.documentDispatchCount).toBe(1);
    });

    it('keeps a whole-file same-file move to one undoable dispatch without extra padding', async () => {
        const targetFile = createMarkdownFile('Daily.md');
        const sourceView = createMutableView('move');
        const app = createAppStub({
            leaves: [createMarkdownLeaf(targetFile, sourceView)],
        });

        const result = await new FileBlockMover(app).moveBlockToFile({
            sourceView,
            source: sourceFromBlock(createBlock(0, 0)),
            targetFile,
        });

        expect(result.moved).toBe(true);
        expect(sourceView.state.doc.toString()).toBe('move');
        expect(sourceView.documentDispatchCount).toBe(1);
    });
});

describe('appendMarkdownBlock', () => {
    it('keeps readable spacing when appending to existing notes', () => {
        expect(appendMarkdownBlock('', 'moved\n')).toBe('moved');
        expect(appendMarkdownBlock('archive', 'moved')).toBe('archive\n\nmoved');
        expect(appendMarkdownBlock('archive\n', 'moved')).toBe('archive\n\nmoved');
        expect(appendMarkdownBlock('archive\n\n', 'moved')).toBe('archive\n\nmoved');
    });
});

function createMutableView(initialDoc: string): MutableView {
    let state = EditorState.create({ doc: initialDoc });
    let documentDispatchCount = 0;
    return {
        get state() {
            return state;
        },
        get documentDispatchCount() {
            return documentDispatchCount;
        },
        dispatch(spec: TransactionSpec) {
            if (spec.changes) {
                documentDispatchCount += 1;
            }
            state = state.update(spec).state;
        },
    } as unknown as MutableView;
}

function createBlock(startLine: number, endLine: number): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine,
        from: 0,
        to: 0,
        indentLevel: 0,
        content: '',
    };
}

function sourceFromBlock(block: BlockInfo, ranges = [{ startLine: block.startLine, endLine: block.endLine }]) {
    return createDragSource(block, ranges);
}

function createMarkdownFile(path: string): TFile {
    const extension = path.split('.').pop() ?? '';
    return {
        path,
        name: path.split('/').pop() ?? path,
        basename: path.replace(/\.md$/, ''),
        extension,
    } as TFile;
}

function createMarkdownLeaf(file: TFile, editorView: EditorView) {
    return {
        view: {
            file,
            editor: { cm: editorView },
            getViewType: () => 'markdown',
        },
    };
}

function createAppStub(options?: {
    leaves?: ReturnType<typeof createMarkdownLeaf>[];
    processFile?: (file: TFile, fn: (data: string) => string) => Promise<string>;
}): App {
    const processFile = options?.processFile ?? (async (_file: TFile, fn: (data: string) => string) => fn(''));
    return {
        workspace: {
            getLeavesOfType: () => options?.leaves ?? [],
        },
        vault: {
            process: processFile,
        },
    } as unknown as App;
}
