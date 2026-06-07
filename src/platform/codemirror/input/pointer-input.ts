import { EditorView } from '@codemirror/view';
import type { BlockInfo } from '../../../domain/block/block-types';
import { buildRangeSelectionBoundaryFromBlock, type RangeSelectionBoundary } from '../../../drag/selection/range-selection-state';

export type PointerInputKind = 'down' | 'move' | 'up' | 'cancel' | 'lost_capture';
export type KeyboardInputKind = 'keydown';
export type FocusInputKind = 'focusin' | 'blur';
export type VisibilityInputKind = 'visibilitychange';

export type PointerInput = {
    kind: PointerInputKind;
    target: HTMLElement | null;
    button: number;
    buttons: number;
    pointerId: number;
    clientX: number;
    clientY: number;
    pointerType: string | null;
    shiftKey: boolean;
};

export type KeyboardInput = {
    kind: KeyboardInputKind;
    key: string;
    target: EventTarget | null;
};

export type FocusInput = {
    kind: FocusInputKind;
    target: EventTarget | null;
};

export type VisibilityInput = {
    kind: VisibilityInputKind;
    visibilityState: DocumentVisibilityState;
};

export type InteractionInput = PointerInput | KeyboardInput | FocusInput | VisibilityInput;

export function readPointerInput(kind: PointerInputKind, event: PointerEvent): PointerInput {
    return {
        kind,
        target: event.target instanceof HTMLElement ? event.target : null,
        button: event.button,
        buttons: event.buttons,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerType: event.pointerType || null,
        shiftKey: event.shiftKey,
    };
}

export function readKeyboardInput(kind: KeyboardInputKind, event: KeyboardEvent): KeyboardInput {
    return {
        kind,
        key: event.key,
        target: event.target,
    };
}

export function readFocusInput(kind: FocusInputKind, event: FocusEvent | Event): FocusInput {
    return {
        kind,
        target: event.target,
    };
}

export function readVisibilityInput(event: Event): VisibilityInput {
    void event;
    return {
        kind: 'visibilitychange',
        visibilityState: document.visibilityState,
    };
}

export function isMobileEnvironment(): boolean {
    const body = document.body;
    if (body?.classList.contains('is-mobile') || body?.classList.contains('is-phone') || body?.classList.contains('is-tablet')) {
        return true;
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function shouldStartMobilePressDrag(e: PointerEvent): boolean {
    return e.pointerType === 'touch'
        && e.button === 0;
}

export function shouldDisableMobileTextLongPressDragInInputState(view: EditorView): boolean {
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl) return false;
    if (!view.dom.contains(activeEl)) return false;
    if (activeEl.isContentEditable) return true;
    return activeEl.matches('input, textarea, select');
}

export function autoScrollNearViewportEdge(scroller: HTMLElement, clientY: number): boolean {
    const rect = scroller.getBoundingClientRect();
    const topEdgeZone = 88;
    const bottomEdgeZone = 88;
    let delta = 0;
    if (clientY < rect.top + topEdgeZone) {
        delta = -Math.min(22, ((rect.top + topEdgeZone) - clientY) * 0.35 + 2);
    } else if (clientY > rect.bottom - bottomEdgeZone) {
        delta = Math.min(22, (clientY - (rect.bottom - bottomEdgeZone)) * 0.35 + 2);
    }
    if (delta === 0) return false;
    const previousScrollTop = scroller.scrollTop;
    scroller.scrollTop += delta;
    return scroller.scrollTop !== previousScrollTop;
}

export function autoScrollEditorNearViewportEdge(view: EditorView, clientY: number): boolean {
    const scroller = view.scrollDOM
        ?? view.dom.querySelector<HTMLElement>('.cm-scroller')
        ?? null;
    if (!scroller) return false;
    return autoScrollNearViewportEdge(scroller, clientY);
}

function safeGetBlockInfoAtPoint(
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null,
    clientX: number,
    clientY: number
): BlockInfo | null {
    try {
        return getBlockInfoAtPoint(clientX, clientY);
    } catch {
        return null;
    }
}

export function resolveRangeBoundaryAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null
): RangeSelectionBoundary | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const block = safeGetBlockInfoAtPoint(getBlockInfoAtPoint, clientX, clientY);
    if (!block) return null;
    return buildRangeSelectionBoundaryFromBlock(doc, block);
}
