import { BlockInfo } from '../../domain/block/block-types';
import { DragLifecycleEvent } from '../../shared/types/drag';
import { ListDropIntent } from '../../shared/types/protocol-types';

export function buildPressPendingLifecycleEvent(
    sourceBlock: BlockInfo,
    pointerType: string | null,
    pressReady: boolean
): DragLifecycleEvent {
    return {
        type: 'drag_press_pending',
        phase: 'press_pending',
        sourceBlock,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
        pressReady,
    };
}

export function buildDragStartedLifecycleEvent(
    sourceBlock: BlockInfo,
    pointerType: string | null
): DragLifecycleEvent {
    return {
        type: 'drag_started',
        phase: 'drag_active',
        sourceBlock,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
    };
}

export function buildDragTargetChangedLifecycleEvent(params: {
    sourceBlock: BlockInfo;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    rejectReason: string | null;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_target_changed',
        phase: 'drag_active',
        sourceBlock: params.sourceBlock,
        targetLine: params.targetLine,
        listIntent: params.listIntent,
        rejectReason: params.rejectReason,
        pointerType: params.pointerType,
    };
}

export function buildDropCommitLifecycleEvent(params: {
    sourceBlock: BlockInfo;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_drop_commit',
        phase: 'drop_commit',
        sourceBlock: params.sourceBlock,
        targetLine: params.targetLine,
        listIntent: params.listIntent,
        rejectReason: null,
        pointerType: params.pointerType,
    };
}

export function buildCancelledLifecycleEvent(params: {
    sourceBlock: BlockInfo | null;
    targetLine?: number | null;
    listIntent?: ListDropIntent | null;
    rejectReason: string;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_cancelled',
        phase: 'cancelled',
        sourceBlock: params.sourceBlock,
        targetLine: params.targetLine ?? null,
        listIntent: params.listIntent ?? null,
        rejectReason: params.rejectReason,
        pointerType: params.pointerType,
    };
}

export function buildIdleLifecycleEvent(): DragLifecycleEvent {
    return {
        type: 'drag_idle',
        phase: 'idle',
        sourceBlock: null,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType: null,
    };
}
