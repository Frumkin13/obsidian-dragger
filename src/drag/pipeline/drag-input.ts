import type { BlockSelection } from '../../domain/selection/block-selection';
import type { BlockCommand } from '../../domain/command/block-command';
import type { DragDropSnapshot } from '../drop/drag-drop-snapshot';
import type { GestureCancelReason } from '../state/drag-state';

export type DragPointerInput = {
    pointerId: number;
    pointerType: string | null;
};

export type BeginDragInput<TPreview = unknown> = DragPointerInput & {
    selection: BlockSelection;
    drop: DragDropSnapshot<TPreview>;
};

export type PreviewDragInput<TPreview = unknown> = DragPointerInput & {
    drop: DragDropSnapshot<TPreview>;
};

export type DropCommitResolution<TPreview = unknown> =
    | { type: 'command'; command: BlockCommand; drop: DragDropSnapshot<TPreview> }
    | { type: 'platform_commit'; drop: DragDropSnapshot<TPreview> }
    | { type: 'cancel'; drop: DragDropSnapshot<TPreview>; reason?: string | null };

export type CommitDragInput<TPreview = unknown> = DragPointerInput & {
    resolution: DropCommitResolution<TPreview>;
};

export type CancelDragInput = DragPointerInput & {
    reason: GestureCancelReason | 'session_interrupted';
};
