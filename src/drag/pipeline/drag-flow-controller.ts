import type { ActiveDrag } from '../state/drag-state';
import type { DragEffect } from '../effects/drag-effect';
import type { BeginDragInput, CancelDragInput, CommitDragInput, PreviewDragInput } from './drag-input';
import {
    beginDragPipeline,
    cancelDragPipeline,
    commitDragPipeline,
    updateDragPipeline,
} from './drag-controller';

export type DragFlowBeginResult = {
    drag: ActiveDrag;
    effects: DragEffect[];
};

export class DragFlowController {
    private activeDrag: ActiveDrag | null = null;

    begin(input: BeginDragInput): DragFlowBeginResult {
        const result = beginDragPipeline(input);
        this.activeDrag = result.drag;
        return result;
    }

    preview(input: PreviewDragInput): DragEffect[] {
        if (!this.activeDrag) return [];
        return updateDragPipeline(this.activeDrag, input);
    }

    commit(input: CommitDragInput): DragEffect[] {
        if (!this.activeDrag) return [];
        const effects = commitDragPipeline(this.activeDrag, input);
        if (input.pointerId === this.activeDrag.pointerId) {
            this.activeDrag = null;
        }
        return effects;
    }

    cancel(input: CancelDragInput): DragEffect[] {
        if (!this.activeDrag) return [];
        const effects = cancelDragPipeline(this.activeDrag, input);
        if (input.pointerId === this.activeDrag.pointerId) {
            this.activeDrag = null;
        }
        return effects;
    }

    getActiveDrag(): ActiveDrag | null {
        return this.activeDrag;
    }

    clear(): void {
        this.activeDrag = null;
    }
}
