import { EditorView } from '@codemirror/view';

function getMainContentLineElementByScan(view: EditorView, lineNumber: number): HTMLElement | null {
    if (typeof view.posAtDOM !== 'function') return null;
    const lineEls = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line'));
    for (const lineEl of lineEls) {
        try {
            const pos = view.posAtDOM(lineEl, 0);
            const resolvedLineNumber = view.state.doc.lineAt(pos).number;
            if (resolvedLineNumber === lineNumber) {
                return lineEl;
            }
        } catch {
            // Skip invalid candidates.
        }
    }
    return null;
}

function getMainContentLineElementByDomAtPos(view: EditorView, lineNumber: number): HTMLElement | null {
    if (typeof view.domAtPos !== 'function') return null;
    try {
        const line = view.state.doc.line(lineNumber);
        const domAtPos = view.domAtPos(line.from);
        const base = domAtPos.node.nodeType === Node.TEXT_NODE
            ? domAtPos.node.parentElement
            : domAtPos.node;
        if (!(base instanceof Element)) return null;
        const lineEl = base.closest<HTMLElement>('.cm-line');
        if (!lineEl) return null;
        if (!view.contentDOM.contains(lineEl)) return null;
        return lineEl;
    } catch {
        return null;
    }
}

export function getMainContentLineElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    return getMainContentLineElementByScan(view, lineNumber)
        ?? getMainContentLineElementByDomAtPos(view, lineNumber);
}

export function getMainContentLineRectForLine(view: EditorView, lineNumber: number): DOMRect | null {
    const lineEl = getMainContentLineElementForLine(view, lineNumber);
    if (!lineEl) return null;
    const rect = lineEl.getBoundingClientRect();
    if (!(rect.height > 0)) return null;
    return rect;
}
