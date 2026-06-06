import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../shared/dom-selectors';
import type { DragIntent } from './drag-intent';

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
