import { describe, expect, it } from 'vitest';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import { BlockType } from '../../domain/block/block-types';
import { createBlockRangeSelectionState } from '../selection/block-range-selection';
import { reducePipeline } from './pipeline-reducer';
import type { PipelineState } from './pipeline-state';

const block = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

const selection = createSingleBlockSelection(block);

describe('drag pipeline reducer', () => {
    it('moves from holding to dragging through a ready hold', () => {
        const hold = reducePipeline({ type: 'idle' }, {
            type: 'hold_start',
            sessionId: 's1',
            target: { selection, source: 'handle' },
        });

        expect(hold.state.type).toBe('holding');

        const ready = reducePipeline(hold.state, { type: 'hold_ready', sessionId: 's1' });
        expect(ready.state.type).toBe('ready_to_drag');

        const dragging = reducePipeline(ready.state, {
            type: 'drag_start',
            sessionId: 's1',
            drop: { target: null, rejectReason: 'no_target' },
        });
        expect(dragging.state.type).toBe('dragging');
        expect(dragging.outputs.some((output) => output.type === 'drag_over')).toBe(true);
    });

    it('keeps selection as a passive pipeline state after finish', () => {
        const start = reducePipeline({ type: 'idle' }, {
            type: 'selection_start',
            seed: { selection },
        });
        const finish = reducePipeline(start.state, { type: 'selection_finish' });

        expect(finish.state).toEqual({
            type: 'selecting',
            selection: {
                selection,
                phase: 'passive',
                guardDeps: [],
            },
        } satisfies PipelineState);
    });

    it('updates selecting state through drag selection policy', () => {
        const rangeState = createBlockRangeSelectionState({
            doc: { lines: 3 },
            blockInfo: block,
            selectedBlocks: [],
        });
        const start = reducePipeline({ type: 'idle' }, {
            type: 'selection_start',
            seed: { selection, rangeState: rangeState! },
        });

        const changed = reducePipeline(start.state, {
            type: 'selection_change',
            boundary: {
                startLineNumber: 2,
                endLineNumber: 2,
                representativeLineNumber: 2,
            },
            docLines: 3,
            resolveBoundary: (lineNumber) => ({
                startLineNumber: lineNumber,
                endLineNumber: lineNumber,
            }),
        });

        expect(changed.state.type).toBe('selecting');
        if (changed.state.type !== 'selecting') return;
        expect(changed.state.selection.selection.ranges).toEqual([
            { startLine: 0, endLine: 0 },
            { startLine: 1, endLine: 1 },
        ]);
        expect(changed.outputs.some((output) => output.type === 'selection_changed')).toBe(true);
    });
});
