import { EditorView } from '@codemirror/view';
import {
    CODEMIRROR_EDITOR_SELECTOR,
    CODEMIRROR_GUTTER_ELEMENT_CLASS,
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    CODEMIRROR_GUTTERS_AFTER_CLASS,
    CODEMIRROR_GUTTERS_BEFORE_CLASS,
    HANDLE_GUTTER_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
    HANDLE_GUTTER_PROBE_CLASS,
} from '../../../shared/dom-selectors';

function isVisible(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

export function getHandleGutter(view: EditorView): HTMLElement | null {
    const candidates = Array.from(view.dom.querySelectorAll<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`));
    return candidates.find((candidate) => (
        candidate.closest(CODEMIRROR_EDITOR_SELECTOR) === view.dom
        && isVisible(candidate)
    )) ?? null;
}

export function getHandleGutterSide(view: EditorView): 'left' | 'right' | null {
    const gutter = getHandleGutter(view);
    if (!gutter) return null;
    const container = gutter.parentElement;
    if (container?.classList.contains(CODEMIRROR_GUTTERS_AFTER_CLASS)) return 'right';
    if (container?.classList.contains(CODEMIRROR_GUTTERS_BEFORE_CLASS)) return 'left';
    return null;
}

export function getHandleGutterElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    const gutter = getHandleGutter(view);
    if (!gutter) return null;
    const probeSelector = `.${HANDLE_GUTTER_PROBE_CLASS}[data-line-number="${lineNumber}"]`;
    const probe = gutter.querySelector<HTMLElement>(probeSelector);
    if (!probe) return null;
    if (probe.classList.contains(CODEMIRROR_GUTTER_ELEMENT_CLASS)) return probe;
    return probe.closest<HTMLElement>(`${CODEMIRROR_GUTTER_ELEMENT_SELECTOR}.${HANDLE_GUTTER_MARKER_CLASS}`)
        ?? null;
}
