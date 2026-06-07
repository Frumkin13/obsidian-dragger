import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../../shared/dom-selectors';
import type { RangeSelectionOperation } from '../../../domain/selection/block-selection';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';

export type RangeSelectionOptions = {
    skipLongPress?: boolean;
    initialOperation?: RangeSelectionOperation;
};

export type PointerDownAction =
    | { type: 'ignore' }
    | { type: 'start_drag'; selectionRequest: BlockSelectionRequest }
    | { type: 'start_range_selection'; selectionRequest: BlockSelectionRequest; options?: RangeSelectionOptions };

export function isSelectionAction(action: PointerDownAction): action is Extract<PointerDownAction, { selectionRequest: BlockSelectionRequest }> {
    return 'selectionRequest' in action;
}

export function decideDesktopPointerDownAction(params: {
    target: HTMLElement;
    event: PointerEvent;
    hasCommittedSelection: boolean;
    multiLineSelectionEnabled: boolean;
}): PointerDownAction {
    const handle = params.target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return { type: 'ignore' };
    if (params.event.button !== 0) return { type: 'ignore' };

    const selectionRequest = { kind: 'handle' as const, handle };
    if (params.multiLineSelectionEnabled) {
        return {
            type: 'start_range_selection',
            selectionRequest,
            options: params.hasCommittedSelection || params.event.shiftKey
                ? { skipLongPress: true }
                : undefined,
        };
    }

    return { type: 'start_drag', selectionRequest };
}
