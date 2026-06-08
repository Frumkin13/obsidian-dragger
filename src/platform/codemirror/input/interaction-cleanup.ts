import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DragCancelReason } from '../../../drag/pipeline/pipeline-event';
import type { InteractionState } from './interaction-state';

export interface InteractionCleanupHost {
    gesture: InteractionState;
    pointer: {
        detachPointerListeners(): void;
        releasePointerCapture(): void;
    };
    mobile: {
        clearDragInteractionMode(): void;
    };
    deps: {
        pipelineOutputExecutor: {
            hideDropPreview(): void;
        };
        finishDragSession(): void;
    };
    cancelDragAutoScroll(state: { autoScrollFrameId: number | null }): void;
    clearPointerPressState(): void;
    clearMouseRangeSelectState(): void;
    clearCommittedRangeSelection(): void;
    resolveActiveRangeSelection(): BlockSelection | null;
    resolveMobileSelection(): BlockSelection | null;
    emitCancelledLifecycle(source: BlockSelection, rejectReason: DragCancelReason, pointerType: string | null): void;
    emitIdleLifecycle(): void;
}

export type InteractionCleanupOptions = {
    shouldFinishDragSession?: boolean;
    shouldHideDropPreview?: boolean;
    cancelReason?: DragCancelReason | null;
    pointerType?: string | null;
};

export function cleanupInteractionSession(host: InteractionCleanupHost, options?: InteractionCleanupOptions): void {
    const { source, hadDrag } = resolveCleanupContext(host);
    const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
    const shouldHideDropPreview = options?.shouldHideDropPreview ?? hadDrag;
    const cancelReason = options?.cancelReason ?? null;
    const pointerType = options?.pointerType ?? null;

    host.gesture = { phase: 'idle' };
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.clearDragInteractionMode();

    if (shouldHideDropPreview) {
        host.deps.pipelineOutputExecutor.hideDropPreview();
    }
    if (hadDrag && shouldFinishDragSession) {
        host.deps.finishDragSession();
    }
    if (cancelReason && source) {
        host.emitCancelledLifecycle(source, cancelReason, pointerType);
    }
    host.emitIdleLifecycle();
}

function resolveCleanupContext(host: InteractionCleanupHost): { source: BlockSelection | null; hadDrag: boolean } {
    const gesture = host.gesture;
    switch (gesture.phase) {
        case 'dragging':
            host.cancelDragAutoScroll(gesture.drag);
            return {
                source: gesture.drag.selection,
                hadDrag: true,
            };
        case 'press_pending':
            host.clearPointerPressState();
            return {
                source: gesture.press.selection,
                hadDrag: false,
            };
        case 'selecting':
            if (gesture.selection.mode === 'range') {
                const source = host.resolveActiveRangeSelection();
                host.clearMouseRangeSelectState();
                return {
                    source,
                    hadDrag: false,
                };
            }
            const mobileSource = host.resolveMobileSelection();
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
