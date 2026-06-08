import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { SelectedBlockRange } from '../../../domain/selection/block-ranges';
import type {
    RangeSelectionBoundary,
} from '../../../domain/selection/range-selection';
import type { MouseRangeSelectState } from './range-selection-gesture-state';

export type ActiveDrag = {
    selection: BlockSelection;
    pointerId: number;
    pointerType: string | null;
    autoScrollFrameId: number | null;
};

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
    mobileSelectionTimeoutId: number | null;
    cancelMoveThresholdPx: number;
    startMoveThresholdPx: number;
    suppressNativeInteraction: boolean;
};

export type PointerTerminalMode = 'up' | 'cancel';

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
        longPressReady: boolean;
        timeoutId: number | null;
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
    | { phase: 'dragging'; drag: ActiveDrag };
