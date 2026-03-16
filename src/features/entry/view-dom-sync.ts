import { EditorView } from '@codemirror/view';
import { MAIN_EDITOR_CONTENT_CLASS, NO_GUTTER_CLASS, ROOT_EDITOR_CLASS } from '../../shared/dom-selectors';
import { DND_DRAG_SOURCE_HIGHLIGHT_ATTR, DND_DRAG_SOURCE_STYLE_ATTR } from '../../shared/dom-attrs';
import { hasVisibleLineNumberGutter } from '../ui/handle/line-number-gutter';

export function ensureEditorRootClasses(view: EditorView): void {
    view.dom.classList.add(ROOT_EDITOR_CLASS);
    view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
}

export function clearEditorRootClasses(view: EditorView): void {
    view.dom.classList.remove(ROOT_EDITOR_CLASS);
    view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
}

export function syncGutterClass(view: EditorView): void {
    const hasGutter = hasVisibleLineNumberGutter(view);
    view.dom.classList.toggle(NO_GUTTER_CLASS, !hasGutter);
}

export function syncDragSourceStyleAttr(view: EditorView, style: string): void {
    view.dom.setAttribute(DND_DRAG_SOURCE_STYLE_ATTR, style);
}

export function syncDragSourceHighlightAttr(view: EditorView, enabled: boolean): void {
    view.dom.setAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR, enabled ? 'on' : 'off');
}
