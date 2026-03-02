import type { Text } from '@codemirror/state';
import type { BlockInfo } from '../../core/block/block-types';
import type { LineRange } from '../../shared/types/line-range';
import { normalizeLineRange, mergeLineRanges } from '../../shared/utils/line-range';
import {
    type MouseRangeSelectState,
    type RangeSelectConfig,
    buildDragSourceBlockFromRanges,
    cloneBlockInfo,
} from './selection-model';

type CreateInitialRangeSelectionStateOptions = {
    blockInfo: BlockInfo;
    doc: Text;
    committedRangesSnapshot: LineRange[];
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string | null;
    sourceHandle: HTMLElement | null;
};

export function resolveRangeSelectConfig(
    pointerType: string | null,
    mouseLongPressMs: number,
    getTouchRangeSelectLongPressMs: () => number
): RangeSelectConfig {
    if (pointerType === 'mouse') {
        return {
            longPressMs: mouseLongPressMs,
        };
    }

    return {
        longPressMs: getTouchRangeSelectLongPressMs(),
    };
}

export function createInitialRangeSelectionState(
    options: CreateInitialRangeSelectionStateOptions
): MouseRangeSelectState | null {
    const anchorStartLineNumber = options.blockInfo.startLine + 1;
    const anchorEndLineNumber = options.blockInfo.endLine + 1;
    if (
        anchorStartLineNumber < 1
        || anchorEndLineNumber > options.doc.lines
        || anchorStartLineNumber > anchorEndLineNumber
    ) {
        return null;
    }

    const anchorRange = normalizeLineRange(options.doc.lines, anchorStartLineNumber, anchorEndLineNumber);
    const selectionRanges = mergeLineRanges(options.doc.lines, [...options.committedRangesSnapshot, anchorRange]);
    const anchorSelectionBlock = buildDragSourceBlockFromRanges(options.doc, selectionRanges, options.blockInfo);
    const sourceHandleDraggableAttr = options.sourceHandle?.getAttribute('draggable') ?? null;

    return {
        anchorSelectionBlock,
        directDragSourceBlock: cloneBlockInfo(options.blockInfo),
        activeSelectionBlock: anchorSelectionBlock,
        pointerId: options.pointerId,
        startX: options.startX,
        startY: options.startY,
        latestX: options.startX,
        latestY: options.startY,
        pointerType: options.pointerType,
        dragReady: options.pointerType === 'mouse',
        longPressReady: false,
        isIntercepting: options.pointerType !== 'mouse',
        timeoutId: null,
        dragTimeoutId: null,
        sourceHandle: options.sourceHandle,
        sourceHandleDraggableAttr,
        anchorStartLineNumber,
        anchorEndLineNumber,
        currentLineNumber: anchorEndLineNumber,
        committedRangesSnapshot: options.committedRangesSnapshot,
        selectionRanges,
    };
}

export function autoScrollRangeSelection(scroller: HTMLElement, clientY: number): void {
    const rect = scroller.getBoundingClientRect();
    const edgeZone = 44;
    let delta = 0;
    if (clientY < rect.top + edgeZone) {
        delta = -Math.min(22, ((rect.top + edgeZone) - clientY) * 0.35 + 2);
    } else if (clientY > rect.bottom - edgeZone) {
        delta = Math.min(22, (clientY - (rect.bottom - edgeZone)) * 0.35 + 2);
    }
    if (delta === 0) return;
    scroller.scrollTop += delta;
}

