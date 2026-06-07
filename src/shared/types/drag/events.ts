import type { DragSource } from './source';
import type { ListDropIntent } from '../protocol-types';

export type DragSessionPhase =
    | 'idle'
    | 'press_pending'
    | 'drag_active'
    | 'drop_commit'
    | 'cancelled';

export type DragLifecycleEvent =
    | DragIdleLifecycleEvent
    | DragPressPendingLifecycleEvent
    | DragStartedLifecycleEvent
    | DragTargetChangedLifecycleEvent
    | DragDropCommitLifecycleEvent
    | DragCancelledLifecycleEvent;

export interface DragIdleLifecycleEvent {
    type: 'drag_idle';
    phase: 'idle';
    source: null;
    targetLine: null;
    listIntent: null;
    rejectReason: null;
    pointerType: null;
}

export interface DragPressPendingLifecycleEvent {
    type: 'drag_press_pending';
    phase: 'press_pending';
    source: DragSource;
    targetLine: null;
    listIntent: null;
    rejectReason: null;
    pointerType: string | null;
    pressReady: boolean;
}

export interface DragStartedLifecycleEvent {
    type: 'drag_started';
    phase: 'drag_active';
    source: DragSource;
    targetLine: null;
    listIntent: null;
    rejectReason: null;
    pointerType: string | null;
}

export interface DragTargetChangedLifecycleEvent {
    type: 'drag_target_changed';
    phase: 'drag_active';
    source: DragSource;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    rejectReason: string | null;
    pointerType: string | null;
}

export interface DragDropCommitLifecycleEvent {
    type: 'drag_drop_commit';
    phase: 'drop_commit';
    source: DragSource;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    rejectReason: null;
    pointerType: string | null;
}

export interface DragCancelledLifecycleEvent {
    type: 'drag_cancelled';
    phase: 'cancelled';
    source: DragSource | null;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    rejectReason: string;
    pointerType: string | null;
}

export function buildPressPendingLifecycleEvent(
    source: DragSource,
    pointerType: string | null,
    pressReady: boolean
): DragLifecycleEvent {
    return {
        type: 'drag_press_pending',
        phase: 'press_pending',
        source,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
        pressReady,
    };
}

export function buildDragStartedLifecycleEvent(
    source: DragSource,
    pointerType: string | null
): DragLifecycleEvent {
    return {
        type: 'drag_started',
        phase: 'drag_active',
        source,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
    };
}

export function buildDragTargetChangedLifecycleEvent(params: {
    source: DragSource;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    rejectReason: string | null;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_target_changed',
        phase: 'drag_active',
        source: params.source,
        targetLine: params.targetLine,
        listIntent: params.listIntent,
        rejectReason: params.rejectReason,
        pointerType: params.pointerType,
    };
}

export function buildDropCommitLifecycleEvent(params: {
    source: DragSource;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_drop_commit',
        phase: 'drop_commit',
        source: params.source,
        targetLine: params.targetLine,
        listIntent: params.listIntent,
        rejectReason: null,
        pointerType: params.pointerType,
    };
}

export function buildCancelledLifecycleEvent(params: {
    source: DragSource | null;
    targetLine?: number | null;
    listIntent?: ListDropIntent | null;
    rejectReason: string;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_cancelled',
        phase: 'cancelled',
        source: params.source,
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
        source: null,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType: null,
    };
}

export type DragLifecycleListener = (event: DragLifecycleEvent) => void;
