import type { BlockCommand } from '../../domain/command/block-command';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DragDropSnapshot } from '../drop/drag-drop-snapshot';
import type { DragLifecycleEvent } from '../lifecycle/drag-lifecycle';
import type { DragEffect } from './drag-effect';

export interface DragEffectExecutor<TPreview = unknown> {
    showDropPreview(selection: BlockSelection, drop: DragDropSnapshot<TPreview>, pointerType: string | null): void;
    hideDropPreview(): void;
    applyCommand(command: BlockCommand): void;
    emitLifecycle(event: DragLifecycleEvent): void;
}

export function executeDragEffects<TPreview>(
    executor: DragEffectExecutor<TPreview>,
    effects: readonly DragEffect<TPreview>[]
): void {
    for (const effect of effects) {
        switch (effect.type) {
            case 'show_drop_preview':
                executor.showDropPreview(effect.selection, effect.drop, effect.pointerType);
                break;
            case 'hide_drop_preview':
                executor.hideDropPreview();
                break;
            case 'apply_command':
                executor.applyCommand(effect.command);
                break;
            case 'emit_lifecycle':
                executor.emitLifecycle(effect.event);
                break;
        }
    }
}
