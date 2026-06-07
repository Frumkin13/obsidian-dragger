import { describe, expect, it } from 'vitest';
import { BlockType } from '../../domain/block/block-types';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import { decideDragIntent } from './drag-intent';

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

describe('drag intent', () => {
    it('chooses semantic drag and selection intents without platform objects', () => {
        const selection = createSelection();

        expect(decideDragIntent({ selection })).toEqual({ type: 'start_drag', selection });
        expect(decideDragIntent({ rangeSelectionSeed: { selection } })).toEqual({
            type: 'start_range_selection',
            selectionSeed: { selection },
        });
        expect(decideDragIntent({ shouldCommitSelection: true })).toEqual({ type: 'commit_selection' });
    });

    it('prioritizes disabled and cancel facts', () => {
        const selection = createSelection();

        expect(decideDragIntent({ disabled: true, selection })).toEqual({ type: 'ignore' });
        expect(decideDragIntent({ cancelReason: 'pointer_cancelled', selection })).toEqual({
            type: 'cancel',
            reason: 'pointer_cancelled',
        });
    });
});
