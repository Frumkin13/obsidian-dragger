import type { EditorView } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';

type MarkdownViewWithCm = MarkdownView & {
    editor?: {
        cm?: EditorView;
    };
};

export function getCodeMirrorView(markdownView: MarkdownView): EditorView | null {
    const maybeView = (markdownView as MarkdownViewWithCm).editor?.cm;
    return maybeView ?? null;
}
