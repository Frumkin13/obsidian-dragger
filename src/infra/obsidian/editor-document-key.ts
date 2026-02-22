import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView } from 'obsidian';
import { getCodeMirrorView } from './editor-view';

type MarkdownViewWithFile = MarkdownView & {
    file?: {
        path?: string;
    } | null;
};

export function resolveEditorDocumentKey(app: App, editorView: EditorView): string | null {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view;
        if (view.getViewType?.() !== 'markdown') continue;
        const markdownView = view as MarkdownViewWithFile;
        if (getCodeMirrorView(markdownView) !== editorView) continue;
        const path = markdownView.file?.path;
        return typeof path === 'string' && path.length > 0 ? path : null;
    }
    return null;
}
