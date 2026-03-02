import type { BlockInfo } from '../../../core/block/block-types';

export type DragLifecycleState =
    | 'idle'
    | 'press_pending'
    | 'drag_active'
    | 'drop_commit'
    | 'cancelled';

export interface DragListIntent {
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
}

export interface DragLifecycleEvent {
    state: DragLifecycleState;
    sourceBlock: BlockInfo | null;
    targetLine: number | null;
    listIntent: DragListIntent | null;
    rejectReason: string | null;
    pointerType: string | null;
    pressReady?: boolean;
}

export type DragLifecycleListener = (event: DragLifecycleEvent) => void;
