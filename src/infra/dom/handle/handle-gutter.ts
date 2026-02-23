import { EditorView } from '@codemirror/view';

export const HANDLE_GUTTER_CLASS = 'cm-dnd-handle-gutter';
export const HANDLE_GUTTER_MARKER_CLASS = 'dnd-handle-gutter-marker';
export const HANDLE_GUTTER_SPACER_CLASS = 'dnd-handle-gutter-spacer';

function isVisible(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function hasUsableRect(rect: DOMRect): boolean {
    return rect.height > 0;
}

export function getHandleGutter(view: EditorView): HTMLElement | null {
    const candidates = Array.from(view.dom.querySelectorAll<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`));
    return candidates.find((candidate) => (
        candidate.closest('.cm-editor') === view.dom
        && isVisible(candidate)
    )) ?? null;
}

export function getHandleGutterRect(view: EditorView): DOMRect | null {
    const gutter = getHandleGutter(view);
    if (!gutter) return null;
    const rect = gutter.getBoundingClientRect();
    return hasUsableRect(rect) ? rect : null;
}

export function getHandleGutterElementCenterX(view: EditorView): number | null {
    const gutter = getHandleGutter(view);
    if (!gutter) return null;
    const marker = gutter.querySelector<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    if (marker) {
        const markerRect = marker.getBoundingClientRect();
        if (hasUsableRect(markerRect)) {
            return markerRect.left + markerRect.width / 2;
        }
    }
    const gutterRect = gutter.getBoundingClientRect();
    if (!hasUsableRect(gutterRect)) return null;
    return gutterRect.left + gutterRect.width / 2;
}

export function getHandleGutterElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    const gutter = getHandleGutter(view);
    if (!gutter) return null;
    const selector = `.${HANDLE_GUTTER_MARKER_CLASS}[data-line-number="${lineNumber}"]`;
    return gutter.querySelector<HTMLElement>(selector);
}
