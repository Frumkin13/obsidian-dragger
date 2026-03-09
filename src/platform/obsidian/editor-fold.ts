import type { EditorView } from '@codemirror/view';
import type { App, Editor } from 'obsidian';
import { resolveMarkdownViewForEditor } from './editor-markdown-view';

interface ElementLike {
    classList?: {
        contains: (className: string) => boolean;
    };
    closest?: (selector: string) => ElementLike | null;
    querySelector?: (selector: string) => unknown;
}

interface NodeLike {
    nodeType?: number;
    parentElement?: ElementLike | null;
}

const TEXT_NODE = 3;

function isElementLike(value: unknown): value is ElementLike {
    if (!value || typeof value !== 'object') return false;
    return typeof (value as ElementLike).closest === 'function';
}

function resolveVisibleLineElement(view: EditorView, lineNumber: number): ElementLike | null {
    try {
        const line = view.state.doc.line(lineNumber);
        const block = typeof view.lineBlockAt === 'function'
            ? view.lineBlockAt(line.from)
            : null;
        if (block && typeof block.from === 'number' && block.from !== line.from) {
            return null;
        }

        const domAtPos = view.domAtPos(line.from);
        const rawNode = domAtPos.node as NodeLike | ElementLike;
        const base = (rawNode as NodeLike).nodeType === TEXT_NODE
            ? (rawNode as NodeLike).parentElement ?? null
            : rawNode;
        if (!isElementLike(base)) return null;
        return base.closest?.('.cm-line') ?? null;
    } catch {
        return null;
    }
}

export function isEditorLineCollapsed(view: EditorView, lineNumber: number): boolean {
    const lineEl = resolveVisibleLineElement(view, lineNumber);
    if (!lineEl) return false;

    if (lineEl.classList?.contains('is-collapsed') || lineEl.classList?.contains('cm-folded')) {
        return true;
    }

    return !!lineEl.querySelector?.(
        '.cm-foldPlaceholder, .cm-fold-indicator.is-collapsed, .collapse-indicator.is-collapsed'
    );
}

function restoreSelectionsAndScroll(editor: Editor, selections: ReturnType<Editor['listSelections']>, scroll: ReturnType<Editor['getScrollInfo']>): void {
    editor.setSelections(selections);
    editor.scrollTo(scroll.left, scroll.top);
}

export function toggleLineFolds(params: {
    app: App;
    view: EditorView;
    targetLineNumbers: number[];
}): void {
    const { app, view, targetLineNumbers } = params;
    if (targetLineNumbers.length === 0) return;

    const markdownView = resolveMarkdownViewForEditor(app, view);
    const editor = markdownView?.editor;
    if (!editor) return;

    const selections = editor.listSelections();
    const scroll = editor.getScrollInfo();
    const hadFocus = editor.hasFocus();

    try {
        for (const targetLineNumber of [...new Set(targetLineNumbers)].sort((a, b) => b - a)) {
            if (targetLineNumber < 1 || targetLineNumber > editor.lineCount()) continue;
            if (isEditorLineCollapsed(view, targetLineNumber)) continue;

            editor.setCursor({ line: targetLineNumber - 1, ch: 0 });
            editor.exec('toggleFold');
        }
    } finally {
        restoreSelectionsAndScroll(editor, selections, scroll);
        if (!hadFocus && editor.hasFocus()) {
            editor.blur();
        }
    }
}
