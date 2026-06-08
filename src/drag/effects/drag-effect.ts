import type { BlockCommand } from '../../domain/command/block-command';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DragDropSnapshot } from '../drop/drag-drop-snapshot';
import type { DragLifecycleEvent } from '../lifecycle/drag-lifecycle';

export type DragEffect<TPreview = unknown> =
    | { type: 'show_drop_preview'; selection: BlockSelection; drop: DragDropSnapshot<TPreview>; pointerType: string | null }
    | { type: 'hide_drop_preview' }
    | { type: 'apply_command'; command: BlockCommand }
    | { type: 'emit_lifecycle'; event: DragLifecycleEvent };
