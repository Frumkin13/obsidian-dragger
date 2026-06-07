import type { CommittedRangeSelection } from '../state/selection/selection-model';
import {
    CODEMIRROR_CONTENT_SELECTOR,
    CODEMIRROR_GUTTERS_SELECTOR,
    DRAG_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../shared/dom-selectors';
import {
    groupSelectedBlocksIntoSegments,
    type BlockSelectionSegment,
} from '../state/selection/block-selection';

export const RANGE_SELECTION_GRIP_HIT_PADDING_PX = 20;
export const RANGE_SELECTION_GRIP_HIT_X_PADDING_PX = 28;

type AnchorSpan = {
    x: number;
    topY: number;
    bottomY: number;
};

type ResolveAnchorSpan = (segment: BlockSelectionSegment) => AnchorSpan | null;

function getCommittedSelectionDocLineCount(committedSelection: CommittedRangeSelection): number {
    return Math.max(
        committedSelection.templateBlock.endLine + 1,
        ...committedSelection.blocks.map((block) => block.endLineNumber)
    );
}

function getCommittedSelectionAnchorMaxX(
    committedSelection: CommittedRangeSelection,
    resolveAnchorSpan: ResolveAnchorSpan
): number | null {
    let maxX: number | null = null;
    const segments = groupSelectedBlocksIntoSegments(
        getCommittedSelectionDocLineCount(committedSelection),
        committedSelection.blocks
    );
    for (const segment of segments) {
        const anchorSpan = resolveAnchorSpan(segment);
        if (!anchorSpan) continue;
        maxX = maxX === null ? anchorSpan.x : Math.max(maxX, anchorSpan.x);
    }
    return maxX;
}

type ShouldClearCommittedSelectionOptions = {
    committedSelection: CommittedRangeSelection | null;
    target: HTMLElement;
    clientX: number;
    pointerType: string | null;
    resolveAnchorSpan: ResolveAnchorSpan;
    isWithinContentTolerance: (clientX: number) => boolean;
    contentDOM: HTMLElement;
};

export function shouldClearCommittedSelectionOnPointerDown(options: ShouldClearCommittedSelectionOptions): boolean {
    const committedSelection = options.committedSelection;
    if (!committedSelection) return false;
    if (options.target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`)) return false;
    if (options.target.closest(`.${DRAG_HANDLE_CLASS}`)) return false;

    if (options.pointerType && options.pointerType !== 'mouse') {
        if (!options.isWithinContentTolerance(options.clientX)) {
            return true;
        }
        const inContent = options.contentDOM.contains(options.target) || !!options.target.closest(CODEMIRROR_CONTENT_SELECTOR);
        const inGutter = !!options.target.closest(CODEMIRROR_GUTTERS_SELECTOR);
        return !inContent && !inGutter;
    }

    const anchorMaxX = getCommittedSelectionAnchorMaxX(committedSelection, options.resolveAnchorSpan);
    if (anchorMaxX === null) return false;
    return options.clientX > anchorMaxX + RANGE_SELECTION_GRIP_HIT_X_PADDING_PX;
}

type IsCommittedSelectionGripHitOptions = {
    committedSelection: CommittedRangeSelection | null;
    target: HTMLElement;
    clientX: number;
    clientY: number;
    pointerType: string | null;
    resolveAnchorSpan: ResolveAnchorSpan;
    isWithinMobileDragHotzoneBand: (clientX: number) => boolean;
};

export function isCommittedSelectionGripHit(options: IsCommittedSelectionGripHitOptions): boolean {
    const committedSelection = options.committedSelection;
    if (!committedSelection) return false;

    const hitHandle = options.target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
    if (hitHandle) return true;

    if (options.pointerType && options.pointerType !== 'mouse') {
        if (!options.isWithinMobileDragHotzoneBand(options.clientX)) {
            return false;
        }
    }

    const segments = groupSelectedBlocksIntoSegments(
        getCommittedSelectionDocLineCount(committedSelection),
        committedSelection.blocks
    );
    for (const segment of segments) {
        const anchorSpan = options.resolveAnchorSpan(segment);
        if (!anchorSpan) continue;
        if (!options.pointerType || options.pointerType === 'mouse') {
            if (Math.abs(options.clientX - anchorSpan.x) > RANGE_SELECTION_GRIP_HIT_X_PADDING_PX) {
                continue;
            }
        }
        const top = anchorSpan.topY - RANGE_SELECTION_GRIP_HIT_PADDING_PX;
        const bottom = anchorSpan.bottomY + RANGE_SELECTION_GRIP_HIT_PADDING_PX;
        if (options.clientY >= top && options.clientY <= bottom) {
            return true;
        }
    }
    return false;
}
