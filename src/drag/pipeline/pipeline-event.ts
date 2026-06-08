import type { BlockSelection } from '../../domain/selection/block-selection';
import type { BlockCommand } from '../../domain/command/block-command';
import type { RangeSelectionBoundary, RangeSelectionBoundaryResolver } from '../../domain/selection/range-selection';
import type { BlockRangeSelectionState } from '../selection/block-range-selection';
import type { DragDropSnapshot, DropResolution } from './pipeline-drop';
import type { HoldTarget } from './pipeline-state';

export type GuardId = string;

export type DragCancelReason =
    | 'press_cancelled'
    | 'pointer_cancelled'
    | 'session_interrupted'
    | 'selection_invalid'
    | 'guard_unavailable'
    | string;

export type SelectionSeed = {
    selection: BlockSelection;
    rangeState?: BlockRangeSelectionState;
};

export type PipelineEvent<TPreview = unknown> =
    | { type: 'hold_start'; sessionId: string; target: HoldTarget; guardDeps?: GuardId[] }
    | { type: 'hold_ready'; sessionId: string }
    | { type: 'selection_start'; seed: SelectionSeed; guardDeps?: GuardId[] }
    | {
        type: 'selection_change';
        boundary: RangeSelectionBoundary;
        docLines?: number;
        resolveBoundary?: RangeSelectionBoundaryResolver;
    }
    | { type: 'selection_finish' }
    | { type: 'selection_clear' }
    | { type: 'drag_start'; sessionId: string; drop: DragDropSnapshot<TPreview> }
    | { type: 'drag_over'; sessionId: string; drop: DragDropSnapshot<TPreview> }
    | { type: 'drop'; sessionId: string; resolution: DropResolution<TPreview> }
    | { type: 'cancel'; sessionId?: string; reason: DragCancelReason; pointerType?: string | null }
    | { type: 'guard_unavailable'; guardId: GuardId }
    | { type: 'destroy' };

export type CommandDropResolution<TPreview = unknown> = {
    type: 'command';
    command: BlockCommand;
    drop: DragDropSnapshot<TPreview>;
};
