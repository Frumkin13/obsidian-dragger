import type { EditorView } from '@codemirror/view';
import { autoScrollNearViewportEdge } from './auto-scroll';

export function autoScrollEditorNearViewportEdge(view: EditorView, clientY: number): boolean {
    const scroller = view.scrollDOM
        ?? view.dom.querySelector<HTMLElement>('.cm-scroller')
        ?? null;
    if (!scroller) return false;
    return autoScrollNearViewportEdge(scroller, clientY);
}
