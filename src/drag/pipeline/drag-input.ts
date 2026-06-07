import type { BlockSelection } from '../../domain/selection/block-selection';
import type { BlockCommand } from '../../domain/command/block-command';
import type { DragDropSnapshot } from '../drop/drag-drop-snapshot';
import type { GestureCancelReason } from '../state/drag-state';

export type DragPointerInput = {
    pointerId: number;
    pointerType: string | null;
};

export type BeginDragInput = DragPointerInput & {
    selection: BlockSelection;
    drop: DragDropSnapshot;
};

export type PreviewDragInput = DragPointerInput & {
    drop: DragDropSnapshot;
};

export type CommitDragInput = DragPointerInput & {
    command: BlockCommand | null;
    drop: DragDropSnapshot;
    didCommit?: boolean;
};

export type CancelDragInput = DragPointerInput & {
    reason: GestureCancelReason | 'session_interrupted';
};
