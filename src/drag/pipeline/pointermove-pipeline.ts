import { DragSource } from '../../shared/types/drag';
import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../shared/dom-selectors';
import { readPointerInput } from '../input';
import { resolveRangeBoundaryAtPoint } from '../input/range-boundary-hit';
import {
    autoScrollSelectionRange as autoScrollSelectionRangeByFlow,
} from '../selection';
import {
    buildRangeSelectionBoundaryFromBlock,
    type MouseRangeSelectState,
    type RangeSelectionBoundary,
} from '../state/selection';
import { handleMobileSelectingPointerMove } from '../selection';
import type { DragEventHandler } from './drag-controller';

const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX = 4;

export type PointerMovePipelineHost = DragEventHandler;

export function runPointerMovePipeline(host: PointerMovePipelineHost, e: PointerEvent): void {
    readPointerInput('move', e);
    switch (host.gesture.phase) {
        case 'dragging':
            handleDraggingPointerMove(host, e);
            return;
        case 'selecting':
            if (host.gesture.selection.mode === 'range') {
                handleRangeSelectingPointerMove(host, e);
            } else {
                handleMobileSelectingPointerMove(host, e);
            }
            return;
        case 'press_pending':
            handlePressPendingPointerMove(host, e);
            return;
        default:
            return;
    }
}

function handleDraggingPointerMove(host: PointerMovePipelineHost, e: PointerEvent): void {
    if (host.gesture.phase !== 'dragging') return;
    const dragState = host.gesture.drag;
    if (e.pointerId !== dragState.pointerId) return;
    dragState.latestX = e.clientX;
    dragState.latestY = e.clientY;
    dragState.pointerType = e.pointerType || dragState.pointerType;
    e.preventDefault();
    e.stopPropagation();
    host.deps.renderDropPreviewAtPoint(e.clientX, e.clientY, dragState.source, e.pointerType || null);
    if (autoScrollDrag(host, dragState)) {
        scheduleDragAutoScroll(host, dragState);
    }
}

function autoScrollDrag(
    host: PointerMovePipelineHost,
    dragState: { latestX: number; latestY: number; source: DragSource; pointerType: string | null }
): boolean {
    const didScroll = autoScrollSelectionRangeByFlow(host.view, dragState.latestY);
    if (didScroll) {
        host.deps.renderDropPreviewAtPoint(dragState.latestX, dragState.latestY, dragState.source, dragState.pointerType);
    }
    return didScroll;
}

function scheduleDragAutoScroll(host: PointerMovePipelineHost, dragState: { autoScrollFrameId: number | null }): void {
    if (dragState.autoScrollFrameId !== null) return;
    dragState.autoScrollFrameId = window.requestAnimationFrame(() => {
        if (host.gesture.phase !== 'dragging') return;
        const state = host.gesture.drag;
        state.autoScrollFrameId = null;
        if (!autoScrollDrag(host, state)) return;
        scheduleDragAutoScroll(host, state);
    });
}

function handleRangeSelectingPointerMove(host: PointerMovePipelineHost, e: PointerEvent): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
    const rangeState = host.gesture.selection.rangeSelect;
    if (rangeState.pointerId !== -1 && e.pointerId !== rangeState.pointerId) return;
    handleRangeSelectionPointerMove(host, e, rangeState);
}

function handlePressPendingPointerMove(host: PointerMovePipelineHost, e: PointerEvent): void {
    if (host.gesture.phase !== 'press_pending') return;
    const pressState = host.gesture.press;
    if (e.pointerId !== pressState.pointerId) return;

    pressState.latestX = e.clientX;
    pressState.latestY = e.clientY;

    const dx = e.clientX - pressState.startX;
    const dy = e.clientY - pressState.startY;
    const distance = Math.hypot(dx, dy);

    if (!pressState.longPressReady) {
        if (distance > pressState.cancelMoveThresholdPx) {
            host.abortForGestureCancel('press_cancelled', e.pointerType || null);
        }
        return;
    }

    if (distance < pressState.startMoveThresholdPx) return;

    e.preventDefault();
    e.stopPropagation();
    const source = pressState.source;
    const pointerId = pressState.pointerId;
    host.clearCommittedRangeSelection();
    host.gesture = { phase: 'idle' };
    host.enterDraggingState(source, pointerId, e.clientX, e.clientY, e.pointerType || null);
}

function handleRangeSelectionPointerMove(
    host: PointerMovePipelineHost,
    e: PointerEvent,
    state: MouseRangeSelectState
): void {
    state.latestX = e.clientX;
    state.latestY = e.clientY;
    const pointerType = state.pointerType ?? (e.pointerType || null);
    const distance = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (state.pointerId === -1 && pointerType !== 'mouse' && host.mobile.isMostlyVerticalScrollGesture(dx, dy)) {
        host.commitRangeSelection(state);
        host.finishRangeSelectionSession();
        return;
    }

    if (!state.longPressReady) {
        if (pointerType === 'mouse') {
            if (distance >= MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) {
                e.preventDefault();
                e.stopPropagation();
                const source = host.resolveDragSource(host.buildDirectRangeSelectionSourceRequest(state));
                if (!source) return;
                const pointerId = state.pointerId;
                host.clearCommittedRangeSelection();
                host.clearMouseRangeSelectState();
                host.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType);
            }
        } else {
            if (!state.dragReady) {
                if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                    host.abortForGestureCancel('press_cancelled', pointerType);
                }
                return;
            }
            if (distance >= MOBILE_DRAG_START_MOVE_THRESHOLD_PX) {
                e.preventDefault();
                e.stopPropagation();
                const source = host.resolveDragSource(host.buildDirectRangeSelectionSourceRequest(state));
                if (!source) return;
                const pointerId = state.pointerId;
                host.clearCommittedRangeSelection();
                host.clearMouseRangeSelectState();
                host.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType);
            }
        }
        return;
    }

    if (pointerType === 'mouse' && state.preferLongPressDrag && !state.selectionGestureStarted) {
        if (!state.dragReady) {
            if (distance < MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) return;
        } else {
            if (distance < MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) return;
            e.preventDefault();
            e.stopPropagation();
            const source = host.getCommittedSelectionSource() ?? host.resolveDragSource(host.buildActiveRangeSelectionSourceRequest(state));
            if (!source) return;
            const pointerId = state.pointerId;
            host.clearCommittedRangeSelection();
            host.clearMouseRangeSelectState();
            host.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType);
            return;
        }
    }

    host.activateMouseRangeSelectInterception(state);
    e.preventDefault();
    e.stopPropagation();

    const targetBoundary = resolveHandleRangeBoundaryAtPoint(host, e.clientX, e.clientY)
        ?? resolveRangeBoundaryAtPoint(host.view, e.clientX, e.clientY, (x, y) => host.resolveDragSource({ kind: 'point', clientX: x, clientY: y })?.primaryBlock ?? null);
    if (targetBoundary) {
        host.updateMouseRangeSelection(state, targetBoundary);
    }

    autoScrollSelectionRangeByFlow(host.view, e.clientY);
}

function resolveHandleRangeBoundaryAtPoint(
    host: PointerMovePipelineHost,
    clientX: number,
    clientY: number
): RangeSelectionBoundary | null {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
        return null;
    }
    const hit = document.elementFromPoint(clientX, clientY);
    if (!(hit instanceof HTMLElement)) return null;

    const handle = hit.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return null;
    if (!host.view.dom.contains(handle)) return null;

    const source = host.resolveDragSource({ kind: 'handle', handle });
    if (!source) return null;
    return buildRangeSelectionBoundaryFromBlock(host.view.state.doc, source.primaryBlock);
}
