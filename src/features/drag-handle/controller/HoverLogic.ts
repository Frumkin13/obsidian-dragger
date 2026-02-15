import type { EditorView } from '@codemirror/view';
import { hasVisibleLineNumberGutter } from '../../../infra/dom/handle/handle-positioner';

interface HandleVisibilityLike {
    resolveVisibleHandleFromPointerWhenLineNumbersHidden: (
        clientX: number,
        clientY: number
    ) => HTMLElement | null;
}

export function resolveHoverHandle(
    view: EditorView,
    visibility: HandleVisibilityLike,
    clientX: number,
    clientY: number
): HTMLElement | null {
    if (hasVisibleLineNumberGutter(view)) return null;
    return visibility.resolveVisibleHandleFromPointerWhenLineNumbersHidden(clientX, clientY);
}
