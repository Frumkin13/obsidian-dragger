import { EditorView } from '@codemirror/view';
import {
    CODEMIRROR_EDITOR_SELECTOR,
    CODEMIRROR_GUTTERS_AFTER_CLASS,
    CODEMIRROR_GUTTERS_BEFORE_CLASS,
    HANDLE_GUTTER_CLASS,
} from '../../shared/dom-selectors';

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
