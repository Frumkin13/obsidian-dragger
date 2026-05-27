import { BlockInfo } from '../../domain/block/block-types';
import { MouseRangeSelectState, RangeSelectionBoundary } from './range-selection/selection-model';
import { SelectedBlockRange } from './range-selection/block-selection';

export type PointerDragData = {
    sourceBlock: BlockInfo;
    pointerId: number;
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

export type MobileSelectionData = {
    selectedBlocks: SelectedBlockRange[];
    activeAnchor: RangeSelectionBoundary;
    activeFocus: RangeSelectionBoundary;
    activeRangeBlocks: SelectedBlockRange[];
    activeHandle: 'top' | 'bottom' | null;
    pointerId: number | null;
};

export type InteractionState =
    | { phase: 'idle' }
    | { phase: 'press_pending'; press: PointerPressData }
    | { phase: 'range_selecting'; rangeSelect: MouseRangeSelectState }
    | { phase: 'mobile_selecting'; mobileSelect: MobileSelectionData }
    | { phase: 'dragging'; drag: PointerDragData };
