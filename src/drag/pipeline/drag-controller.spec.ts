import { describe, expect, it } from 'vitest';
import { BlockType } from '../../domain/block/block-types';
import { createMoveCommand } from '../../domain/command/move-command';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import {
    beginDragPipeline,
    cancelDragPipeline,
    commitDragPipeline,
    updateDragPipeline,
} from './drag-controller';

function createSelection() {
    return createSingleBlockSelection({
        type: BlockType.Paragraph,
        startLine: 0,
        endLine: 0,
        from: 0,
        to: 5,
        indentLevel: 0,
        content: 'alpha',
    });
}

function createDrop() {
    return {
        target: {
            targetLineNumber: 2,
            placement: 'before' as const,
        },
    };
}

describe('headless drag pipeline', () => {
    it('begins a drag without platform event objects', () => {
        const selection = createSelection();

        const { drag, effects } = beginDragPipeline({
            selection,
            pointerId: 7,
            pointerType: 'mouse',
            drop: createDrop(),
        });

        expect(drag).toMatchObject({
            selection,
            pointerId: 7,
            pointerType: 'mouse',
        });
        expect(effects.map((effect) => effect.type)).toEqual([
            'emit_lifecycle',
            'show_drop_preview',
            'emit_lifecycle',
        ]);
        expect(effects[1]).toEqual({ type: 'show_drop_preview', selection, drop: createDrop() });
    });

    it('updates preview only for the active pointer', () => {
        const selection = createSelection();
        const { drag } = beginDragPipeline({
            selection,
            pointerId: 7,
            pointerType: 'mouse',
            drop: createDrop(),
        });

        const staleEffects = updateDragPipeline(drag, {
            pointerId: 8,
            pointerType: 'mouse',
            drop: createDrop(),
        });
        expect(staleEffects).toEqual([]);

        const effects = updateDragPipeline(drag, {
            pointerId: 7,
            pointerType: 'mouse',
            drop: createDrop(),
        });
        expect(effects.map((effect) => effect.type)).toEqual(['show_drop_preview', 'emit_lifecycle']);
    });

    it('commits by emitting an apply-command effect', () => {
        const selection = createSelection();
        const { drag } = beginDragPipeline({
            selection,
            pointerId: 7,
            pointerType: 'mouse',
            drop: createDrop(),
        });
        const command = createMoveCommand(selection, createDrop().target);

        const effects = commitDragPipeline(drag, {
            pointerId: 7,
            pointerType: 'mouse',
            command,
            drop: createDrop(),
        });

        expect(effects[0]).toEqual({ type: 'apply_command', command });
        expect(effects[1].type).toBe('emit_lifecycle');
    });

    it('cancels through lifecycle and cleanup effects', () => {
        const selection = createSelection();
        const { drag } = beginDragPipeline({
            selection,
            pointerId: 7,
            pointerType: 'mouse',
            drop: createDrop(),
        });

        const effects = cancelDragPipeline(drag, {
            pointerId: 7,
            pointerType: 'mouse',
            reason: 'pointer_cancelled',
        });

        expect(effects.map((effect) => effect.type)).toEqual(['hide_drop_preview', 'emit_lifecycle']);
    });
});
