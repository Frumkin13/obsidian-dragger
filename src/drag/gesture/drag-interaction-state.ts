import { BlockInfo } from '../../domain/block/block-types';
import { MouseRangeSelectState, RangeSelectionBoundary } from './range-selection/selection-model';
import { SelectedBlockRange } from './range-selection/block-selection';

export type PointerDragData = {
    sourceBlock: BlockInfo;
    pointerId: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    autoScrollFrameId: number | null;
};

export type PointerPressData = {
    sourceBlock: BlockInfo;
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
        sourceBlock: BlockInfo;
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
