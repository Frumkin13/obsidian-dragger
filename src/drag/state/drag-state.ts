import { DragSource } from '../../shared/types/drag';
import { MouseRangeSelectState, RangeSelectionBoundary } from './selection/selection-model';
import { SelectedBlockRange } from './selection/block-selection';

export type PointerDragData = {
    source: DragSource;
    pointerId: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    autoScrollFrameId: number | null;
};

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
    | { phase: 'range_selecting'; rangeSelect: MouseRangeSelectState }
    | { phase: 'mobile_selecting'; mobileSelect: MobileSelectionData }
    | { phase: 'dragging'; drag: PointerDragData };
