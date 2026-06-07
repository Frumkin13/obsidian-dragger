import type { DragSource } from '../../shared/types/drag';
import type { GestureCancelReason, InteractionState } from '../state/drag-state';

export interface DragCleanupHost {
    gesture: InteractionState;
    pointer: {
        detachPointerListeners(): void;
        releasePointerCapture(): void;
    };
    mobile: {
        unlockMobileInteraction(): void;
        detachFocusGuard(): void;
    };
    deps: {
        hideDropIndicator(): void;
        finishDragSession(): void;
    };
    cancelDragAutoScroll(state: { autoScrollFrameId: number | null }): void;
    clearPointerPressState(): void;
    clearMouseRangeSelectState(): void;
    clearCommittedRangeSelection(): void;
    resolveActiveRangeSelectionSource(): DragSource | null;
    resolveMobileSelectionSource(): DragSource | null;
    emitCancelledLifecycle(source: DragSource, rejectReason: GestureCancelReason | 'session_interrupted', pointerType: string | null): void;
    emitIdleLifecycle(): void;
}

export type DragCleanupOptions = {
    shouldFinishDragSession?: boolean;
    shouldHideDropIndicator?: boolean;
    cancelReason?: GestureCancelReason | 'session_interrupted' | null;
    pointerType?: string | null;
};

export function cleanupInteractionSession(host: DragCleanupHost, options?: DragCleanupOptions): void {
    const { source, hadDrag } = resolveCleanupContext(host);
    const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
    const shouldHideDropIndicator = options?.shouldHideDropIndicator ?? hadDrag;
    const cancelReason = options?.cancelReason ?? null;
    const pointerType = options?.pointerType ?? null;

    host.gesture = { phase: 'idle' };
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.unlockMobileInteraction();
    host.mobile.detachFocusGuard();

    if (shouldHideDropIndicator) {
        host.deps.hideDropIndicator();
    }
    if (hadDrag && shouldFinishDragSession) {
        host.deps.finishDragSession();
    }
    if (cancelReason && source) {
        host.emitCancelledLifecycle(source, cancelReason, pointerType);
    }
    host.emitIdleLifecycle();
}

function resolveCleanupContext(host: DragCleanupHost): { source: DragSource | null; hadDrag: boolean } {
    const gesture = host.gesture;
    switch (gesture.phase) {
        case 'dragging':
            host.cancelDragAutoScroll(gesture.drag);
            return {
                source: gesture.drag.source,
                hadDrag: true,
            };
        case 'press_pending':
            host.clearPointerPressState();
            return {
                source: gesture.press.source,
                hadDrag: false,
            };
        case 'selecting':
            if (gesture.selection.mode === 'range') {
                const source = host.resolveActiveRangeSelectionSource();
                host.clearMouseRangeSelectState();
                return {
                    source,
                    hadDrag: false,
                };
            }
            const mobileSource = host.resolveMobileSelectionSource();
            host.clearCommittedRangeSelection();
            return {
                source: mobileSource,
                hadDrag: false,
            };
        default:
            return {
                source: null,
                hadDrag: false,
            };
    }
}
