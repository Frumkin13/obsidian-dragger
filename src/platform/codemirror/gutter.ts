import { EditorView } from '@codemirror/view';
import {
    CODEMIRROR_EDITOR_SELECTOR,
    CODEMIRROR_GUTTERS_BEFORE_CLASS,
    CODEMIRROR_GUTTERS_SELECTOR,
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

export function placeHandleGutterForConfiguredSide(view: EditorView, side: 'left' | 'right'): void {
    const gutter = getHandleGutter(view);
    if (!gutter) return;

    const parent = side === 'right'
        ? view.contentDOM.parentElement
        : view.dom.querySelector<HTMLElement>(`${CODEMIRROR_GUTTERS_SELECTOR}.${CODEMIRROR_GUTTERS_BEFORE_CLASS}`);
    if (!parent || gutter.parentElement === parent) return;
    parent.appendChild(gutter);
}
