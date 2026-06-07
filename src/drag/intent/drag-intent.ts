import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../shared/dom-selectors';
import type { RangeSelectionOperation } from '../../shared/types/drag';
import type { DragSourceRequest } from '../source/source';

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

export function decideDesktopPointerDownIntent(params: {
    target: HTMLElement;
    event: PointerEvent;
    hasCommittedSelection: boolean;
    multiLineSelectionEnabled: boolean;
}): DragIntent {
    const handle = params.target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return { type: 'ignore' };
    if (params.event.button !== 0) return { type: 'ignore' };

    const sourceRequest = { kind: 'handle' as const, handle };
    if (params.multiLineSelectionEnabled) {
        return {
            type: 'start_range_selection',
            sourceRequest,
            options: params.hasCommittedSelection || params.event.shiftKey
                ? { skipLongPress: true }
                : undefined,
        };
    }

    return { type: 'start_drag', sourceRequest };
}
