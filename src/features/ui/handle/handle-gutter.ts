import { EditorView } from '@codemirror/view';
import {
    HANDLE_GUTTER_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
    HANDLE_GUTTER_PROBE_CLASS,
} from '../../../shared/dom-selectors';

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
    const lineElement = gutter.querySelector<HTMLElement>(`.cm-gutterElement.${HANDLE_GUTTER_MARKER_CLASS}`)
        ?? gutter.querySelector<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    if (lineElement) {
        const lineElementRect = lineElement.getBoundingClientRect();
        if (hasUsableRect(lineElementRect)) {
            return lineElementRect.left + lineElementRect.width / 2;
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
    const probeSelector = `.${HANDLE_GUTTER_PROBE_CLASS}[data-line-number="${lineNumber}"]`;
    const probe = gutter.querySelector<HTMLElement>(probeSelector);
    if (!probe) return null;
    if (probe.classList.contains('cm-gutterElement')) return probe;
    return probe.closest<HTMLElement>(`.cm-gutterElement.${HANDLE_GUTTER_MARKER_CLASS}`)
        ?? null;
}
