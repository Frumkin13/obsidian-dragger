import { DragSource } from '../../shared/types/drag';
import { MouseRangeSelectState, RangeSelectionBoundary } from './range-selection-state';
import { SelectedBlockRange } from '../../shared/utils/block-ranges';

export type ActiveDrag = PointerDragData;

export type PointerDragData = {
    source: DragSource;
    pointerId: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    autoScrollFrameId: number | null;
};

export type BeginActiveDragInput = {
    source: DragSource;
    pointerId: number;
    clientX: number;
    clientY: number;
    pointerType: string | null;
};

export function beginActiveDrag(input: BeginActiveDragInput): ActiveDrag {
    return {
        source: input.source,
        pointerId: input.pointerId,
        latestX: input.clientX,
        latestY: input.clientY,
        pointerType: input.pointerType,
        autoScrollFrameId: null,
    };
}

export type PointerPressData = {
    source: DragSource;
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
        source: DragSource;
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
