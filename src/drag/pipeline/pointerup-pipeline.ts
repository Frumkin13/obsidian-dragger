import { readPointerInput } from '../input/drag-input';
import type { PointerTerminalMode } from '../state/drag-state';
import { finishMobileSelectionPointer } from './touch-selecting-actions';
import type { DragEventHandler } from './drag-controller';

export function runPointerUpPipeline(host: DragEventHandler, e: PointerEvent): void {
    readPointerInput('up', e);
    runPointerTerminalPipeline(host, e, 'up');
}

export function runPointerCancelPipeline(host: DragEventHandler, e: PointerEvent): void {
    readPointerInput('cancel', e);
    runPointerTerminalPipeline(host, e, 'cancel');
}

function runPointerTerminalPipeline(
    host: DragEventHandler,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    switch (host.gesture.phase) {
        case 'dragging':
            finishPointerDrag(host, e, mode === 'up');
            return;
        case 'selecting':
            if (host.gesture.selection.mode === 'range') {
                finishRangeSelectingPointer(host, e, mode);
            } else {
                finishMobileSelectionPointer(host, e, mode);
            }
            return;
        case 'press_pending':
            finishPressPendingPointer(host, e, mode);
            return;
        default:
            return;
    }
}

function finishPointerDrag(host: DragEventHandler, e: PointerEvent, shouldDrop: boolean): void {
    if (host.gesture.phase !== 'dragging') return;
    const state = host.gesture.drag;
    if (e.pointerId !== state.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (shouldDrop) {
        host.deps.performDropAtPoint(state.source, e.clientX, e.clientY, e.pointerType || null);
    }
    host.cleanupAfterPointerDrag({
        shouldFinishDragSession: true,
        shouldHideDropIndicator: true,
        cancelReason: shouldDrop ? null : 'pointer_cancelled',
        pointerType: e.pointerType || null,
    });
}

function finishRangeSelectingPointer(
    host: DragEventHandler,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
    const rangeState = host.gesture.selection.rangeSelect;
    if (rangeState.pointerId !== -1 && e.pointerId !== rangeState.pointerId) return;
    if (mode === 'cancel') {
        host.abortForGestureCancel('pointer_cancelled', e.pointerType || null);
        return;
    }
    if (!rangeState.longPressReady) {
        if (mode === 'up' && rangeState.pointerType === 'mouse') {
            e.preventDefault();
            e.stopPropagation();
            const source = host.resolveDragSource(host.buildActiveRangeSelectionSourceRequest(rangeState));
            if (source) host.deps.openBlockTypeMenu?.(source.primaryBlock, e);
            host.finishRangeSelectionSession();
            return;
        }
        host.abortForGestureCancel('press_cancelled', e.pointerType || null);
        return;
    }
    if (
        rangeState.preferLongPressDrag
        && rangeState.dragReady
        && !rangeState.selectionGestureStarted
    ) {
        host.finishRangeSelectionSession();
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    host.commitRangeSelection(rangeState);
    host.finishRangeSelectionSession();
}

function finishPressPendingPointer(
    host: DragEventHandler,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    if (host.gesture.phase !== 'press_pending') return;
    const pressState = host.gesture.press;
    if (e.pointerId !== pressState.pointerId) return;
    host.abortForGestureCancel(mode === 'up' ? 'press_cancelled' : 'pointer_cancelled', e.pointerType || null);
}
