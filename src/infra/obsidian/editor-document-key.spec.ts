import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { resolveEditorDocumentKey } from './editor-document-key';

function createAppStub(leaves: Array<{ view: unknown }>): App {
    return {
        workspace: {
            getLeavesOfType: () => leaves,
        },
    } as unknown as App;
}

describe('resolveEditorDocumentKey', () => {
    it('returns file path for the matching editor view', () => {
        const targetEditorView = {} as EditorView;
        const app = createAppStub([
            {
                view: {
                    getViewType: () => 'markdown',
                    editor: { cm: targetEditorView },
                    file: { path: 'folder/note.md' },
                },
            },
        ]);

        expect(resolveEditorDocumentKey(app, targetEditorView)).toBe('folder/note.md');
    });

    it('returns null when no markdown leaf matches the editor view', () => {
        const targetEditorView = {} as EditorView;
        const app = createAppStub([
            {
                view: {
                    getViewType: () => 'markdown',
                    editor: { cm: {} as EditorView },
                    file: { path: 'folder/other.md' },
                },
            },
        ]);

        expect(resolveEditorDocumentKey(app, targetEditorView)).toBeNull();
    });

    it('returns null when matching view has no file path', () => {
        const targetEditorView = {} as EditorView;
        const app = createAppStub([
            {
                view: {
                    getViewType: () => 'markdown',
                    editor: { cm: targetEditorView },
                    file: null,
                },
            },
        ]);

        expect(resolveEditorDocumentKey(app, targetEditorView)).toBeNull();
    });
});
