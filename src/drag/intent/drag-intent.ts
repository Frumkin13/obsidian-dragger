import type { DragSourceRequest } from '../source';
import type { RangeSelectionOperation } from '../../shared/types/drag';

export type RangeSelectionOptions = {
    skipLongPress?: boolean;
    initialOperation?: RangeSelectionOperation;
};

export type DragIntent =
    | { type: 'ignore' }
    | { type: 'start_drag'; sourceRequest: DragSourceRequest }
    | { type: 'start_range_selection'; sourceRequest: DragSourceRequest; options?: RangeSelectionOptions };

export function isSourceIntent(intent: DragIntent): intent is Extract<DragIntent, { sourceRequest: DragSourceRequest }> {
    return 'sourceRequest' in intent;
}
