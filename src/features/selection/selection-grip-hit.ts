import type { CommittedRangeSelection } from './selection-model';
import type { LineRange } from '../../shared/types/line-range';
import {
    DRAG_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    RANGE_SELECTION_LINK_CLASS,
} from '../../shared/dom-selectors';

export const RANGE_SELECTION_GRIP_HIT_PADDING_PX = 20;
export const RANGE_SELECTION_GRIP_HIT_X_PADDING_PX = 28;

type AnchorSpan = {
    x: number;
    topY: number;
    bottomY: number;
};

type ResolveAnchorSpan = (range: LineRange) => AnchorSpan | null;

function getCommittedSelectionAnchorMaxX(
    committedSelection: CommittedRangeSelection,
    resolveAnchorSpan: ResolveAnchorSpan
): number | null {
    let maxX: number | null = null;
    for (const range of committedSelection.ranges) {
        const anchorSpan = resolveAnchorSpan(range);
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
    if (options.target.closest(`.${RANGE_SELECTION_LINK_CLASS}`)) return false;
    if (options.target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`)) return false;
    if (options.target.closest(`.${DRAG_HANDLE_CLASS}`)) return false;

    if (options.pointerType && options.pointerType !== 'mouse') {
        if (!options.isWithinContentTolerance(options.clientX)) {
            return true;
        }
        const inContent = options.contentDOM.contains(options.target) || !!options.target.closest('.cm-content');
        const inGutter = !!options.target.closest('.cm-gutters');
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

    const hitLink = options.target.closest(`.${RANGE_SELECTION_LINK_CLASS}`);
    if (hitLink) return true;

    const hitHandle = options.target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
    if (hitHandle) return true;

    if (options.pointerType && options.pointerType !== 'mouse') {
        if (!options.isWithinMobileDragHotzoneBand(options.clientX)) {
            return false;
        }
    }

    for (const range of committedSelection.ranges) {
        const anchorSpan = options.resolveAnchorSpan(range);
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
