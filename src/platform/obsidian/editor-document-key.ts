import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView } from 'obsidian';
import { resolveMarkdownViewForEditor } from './editor-markdown-view';

type MarkdownViewWithFile = MarkdownView & {
    file?: {
        path?: string;
    } | null;
};

export function resolveEditorDocumentKey(app: App, editorView: EditorView): string | null {
    const markdownView = resolveMarkdownViewForEditor(app, editorView) as MarkdownViewWithFile | null;
    const path = markdownView?.file?.path;
    if (typeof path === 'string' && path.length > 0) return path;
    return null;
}
