import type { DragSourceRequest } from '../source';

export type DragCancelReason =
    | 'press_cancelled'
    | 'pointer_cancelled'
    | 'session_interrupted'
    | 'escape'
    | 'blur'
    | 'visibility_hidden';

export type DragIntent =
    | { type: 'ignore' }
    | { type: 'open_menu'; sourceRequest: DragSourceRequest }
    | { type: 'start_drag'; sourceRequest: DragSourceRequest }
    | { type: 'start_press_pending'; sourceRequest: DragSourceRequest }
    | { type: 'start_selection'; sourceRequest: DragSourceRequest }
    | { type: 'update_selection' }
    | { type: 'start_committed_selection_drag'; sourceRequest: DragSourceRequest }
    | { type: 'finish' }
    | { type: 'cancel'; reason: DragCancelReason };
