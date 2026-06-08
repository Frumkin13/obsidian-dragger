import { readPointerInput } from './pointer-input';
import type { PointerTerminalMode } from '../../../drag/state/drag-state';
import { finishMobileSelectionPointer } from './touch-selecting-actions';
import type { PointerDragController } from './pointer-drag-controller';

export function handlePointerUp(host: PointerDragController, e: PointerEvent): void {
    readPointerInput('up', e);
    handlePointerTerminal(host, e, 'up');
}

export function handlePointerCancel(host: PointerDragController, e: PointerEvent): void {
    readPointerInput('cancel', e);
    handlePointerTerminal(host, e, 'cancel');
}

function handlePointerTerminal(
    host: PointerDragController,
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

function finishPointerDrag(host: PointerDragController, e: PointerEvent, shouldDrop: boolean): void {
    if (host.gesture.phase !== 'dragging') return;
    const state = host.gesture.drag;
    if (e.pointerId !== state.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (shouldDrop) {
        host.updateActiveDragPointer(e.clientX, e.clientY, e.pointerType || null);
        const resolved = host.buildActiveDragCommand(state.selection);
        host.applyDragEffects(host.commitActiveDrag({
            pointerId: e.pointerId,
            pointerType: e.pointerType || null,
            resolved,
        }));
    } else {
        host.applyDragEffects(host.cancelActiveDrag({
            pointerId: e.pointerId,
            pointerType: e.pointerType || null,
            reason: 'pointer_cancelled',
        }));
    }
    host.cleanupAfterPointerDrag({
        shouldFinishDragSession: true,
        shouldHideDropPreview: true,
        cancelReason: null,
        pointerType: e.pointerType || null,
    });
}

function finishRangeSelectingPointer(
    host: PointerDragController,
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
            const source = host.resolveBlockSelection(host.buildActiveRangeSelectionSelectionRequest(rangeState));
            if (source) host.deps.openBlockTypeMenu?.(source.anchorBlock, e);
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
    host: PointerDragController,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    if (host.gesture.phase !== 'press_pending') return;
    const pressState = host.gesture.press;
    if (e.pointerId !== pressState.pointerId) return;
    host.abortForGestureCancel(mode === 'up' ? 'press_cancelled' : 'pointer_cancelled', e.pointerType || null);
}
