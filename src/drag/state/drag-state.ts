import type { BlockSelection } from '../../domain/selection/block-selection';

export type ActiveDrag = PointerDragData;

export type PointerDragData = {
    selection: BlockSelection;
    pointerId: number;
    pointerType: string | null;
    autoScrollFrameId: number | null;
};

export type BeginActiveInteractionInput = {
    selection: BlockSelection;
    pointerId: number;
    pointerType: string | null;
};

export function beginActiveDrag(input: BeginActiveInteractionInput): ActiveDrag {
    return {
        selection: input.selection,
        pointerId: input.pointerId,
        pointerType: input.pointerType,
        autoScrollFrameId: null,
    };
}

export type GestureCancelReason = 'press_cancelled' | 'pointer_cancelled';
