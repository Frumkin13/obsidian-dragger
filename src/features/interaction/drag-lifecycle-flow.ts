import { BlockInfo } from '../../core/block/block-types';
import { DragLifecycleEvent } from '../../shared/types/drag';

export function buildPressPendingLifecycleEvent(
    sourceBlock: BlockInfo,
    pointerType: string | null,
    pressReady: boolean
): DragLifecycleEvent {
    return {
        state: 'press_pending',
        sourceBlock,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
        pressReady,
    };
}

export function buildDragActiveLifecycleEvent(
    sourceBlock: BlockInfo,
    pointerType: string | null
): DragLifecycleEvent {
    return {
        state: 'drag_active',
        sourceBlock,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
    };
}

export function buildCancelledLifecycleEvent(
    sourceBlock: BlockInfo,
    rejectReason: string,
    pointerType: string | null
): DragLifecycleEvent {
    return {
        state: 'cancelled',
        sourceBlock,
        targetLine: null,
        listIntent: null,
        rejectReason,
        pointerType,
    };
}

export function buildIdleLifecycleEvent(): DragLifecycleEvent {
    return {
        state: 'idle',
        sourceBlock: null,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType: null,
    };
}

