import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView } from 'obsidian';
import { getCodeMirrorView } from './editor-view';

export function resolveMarkdownViewForEditor(app: App, editorView: EditorView): MarkdownView | null {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view;
        if (view.getViewType?.() !== 'markdown') continue;
        const markdownView = view as MarkdownView;
        if (getCodeMirrorView(markdownView) === editorView) {
            return markdownView;
        }
    }
    return null;
}
