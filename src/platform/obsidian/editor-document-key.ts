import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { resolveMarkdownViewForEditor } from './editor-markdown-view';

export function resolveEditorDocumentKey(app: App, editorView: EditorView): string | null {
    const markdownView = resolveMarkdownViewForEditor(app, editorView);
    const path = markdownView?.file?.path;
    if (typeof path === 'string' && path.length > 0) return path;
    return null;
}
