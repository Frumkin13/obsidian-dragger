import type { BlockSelection } from '../../domain/selection/block-selection';
import { MouseRangeSelectState, RangeSelectionBoundary } from '../selection/range-selection-state';
import { SelectedBlockRange } from '../../domain/selection/block-ranges';

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

export type PointerPressData = {
    selection: BlockSelection;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    longPressReady: boolean;
    timeoutId: number | null;
    cancelMoveThresholdPx: number;
    startMoveThresholdPx: number;
    suppressNativeInteraction: boolean;
};

export type PointerTerminalMode = 'up' | 'cancel';
export type GestureCancelReason = 'press_cancelled' | 'pointer_cancelled';

export type MobileSelectionResizeHandle = 'top' | 'bottom';

export type MobileSelectionInteraction =
    | {
        type: 'resize';
        pointerId: number;
    }
    | {
        type: 'drag';
        pointerId: number;
        startX: number;
        startY: number;
        selection: BlockSelection;
    };

export type MobileSelectionData = {
    selectedBlocks: SelectedBlockRange[];
    activeFixedBoundary: RangeSelectionBoundary;
    activeMovingBoundary: RangeSelectionBoundary;
    activeRangeBlocks: SelectedBlockRange[];
    activeInteraction: MobileSelectionInteraction | null;
};

export type InteractionState =
    | { phase: 'idle' }
    | { phase: 'press_pending'; press: PointerPressData }
    | { phase: 'selecting'; selection: { mode: 'range'; rangeSelect: MouseRangeSelectState } | { mode: 'mobile'; mobileSelect: MobileSelectionData } }
    | { phase: 'dragging'; drag: PointerDragData };
