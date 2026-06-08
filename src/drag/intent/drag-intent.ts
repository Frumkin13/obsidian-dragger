import type { BlockSelection } from '../../domain/selection/block-selection';
import type { RangeSelectionOperation } from '../../domain/selection/block-selection';
import type { GestureCancelReason } from '../state/drag-state';

export type RangeSelectionSeed = {
    selection: BlockSelection;
    operation?: RangeSelectionOperation;
};

export type DragIntent =
    | { type: 'ignore' }
    | { type: 'start_drag'; selection: BlockSelection }
    | { type: 'start_range_selection'; selectionSeed: RangeSelectionSeed }
    | { type: 'commit_selection' }
    | { type: 'cancel'; reason: GestureCancelReason };

export type DragIntentFacts = {
    disabled?: boolean;
    selection?: BlockSelection | null;
    rangeSelectionSeed?: RangeSelectionSeed | null;
    shouldCommitSelection?: boolean;
    cancelReason?: GestureCancelReason | null;
};

export function decideDragIntent(facts: DragIntentFacts): DragIntent {
    if (facts.disabled) return { type: 'ignore' };
    if (facts.cancelReason) return { type: 'cancel', reason: facts.cancelReason };
    if (facts.shouldCommitSelection) return { type: 'commit_selection' };
    if (facts.rangeSelectionSeed) return { type: 'start_range_selection', selectionSeed: facts.rangeSelectionSeed };
    if (facts.selection) return { type: 'start_drag', selection: facts.selection };
    return { type: 'ignore' };
}
