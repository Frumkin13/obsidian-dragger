import type { App, MarkdownView } from 'obsidian';
import { getActiveLeaf } from './workspace';

export function getActiveMarkdownView(app: App): MarkdownView | null {
    const leaf = getActiveLeaf(app);
    if (!leaf) return null;
    const view = leaf.view;
    return view.getViewType?.() === 'markdown' ? (view as MarkdownView) : null;
}
