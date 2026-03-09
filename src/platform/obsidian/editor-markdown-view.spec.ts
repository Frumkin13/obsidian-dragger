import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { resolveMarkdownViewForEditor } from './editor-markdown-view';

function createAppStub(leaves: Array<{ view: unknown }>): App {
    return {
        workspace: {
            getLeavesOfType: () => leaves,
        },
    } as unknown as App;
}

describe('resolveMarkdownViewForEditor', () => {
    it('returns the matching markdown view for an editor view', () => {
        const targetEditorView = {} as EditorView;
        const targetMarkdownView = {
            getViewType: () => 'markdown',
            editor: { cm: targetEditorView },
        };
        const app = createAppStub([{ view: targetMarkdownView }]);

        expect(resolveMarkdownViewForEditor(app, targetEditorView)).toBe(targetMarkdownView);
    });

    it('returns null when no markdown leaf matches the editor view', () => {
        const targetEditorView = {} as EditorView;
        const app = createAppStub([
            {
                view: {
                    getViewType: () => 'markdown',
                    editor: { cm: {} as EditorView },
                },
            },
        ]);

        expect(resolveMarkdownViewForEditor(app, targetEditorView)).toBeNull();
    });
});
