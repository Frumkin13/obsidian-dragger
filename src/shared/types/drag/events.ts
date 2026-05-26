import type { BlockInfo } from '../../../domain/block/block-types';
import type { ListDropIntent } from '../protocol-types';

export type DragLifecycleState =
    | 'idle'
    | 'press_pending'
    | 'drag_active'
    | 'drop_commit'
    | 'cancelled';

export interface DragLifecycleEvent {
    state: DragLifecycleState;
    sourceBlock: BlockInfo | null;
    targetLine: number | null;
    listIntent: ListDropIntent | null;
    rejectReason: string | null;
    pointerType: string | null;
    pressReady?: boolean;
}

export type DragLifecycleListener = (event: DragLifecycleEvent) => void;
