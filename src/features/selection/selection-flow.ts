import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../core/block/block-types';
import {
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    type RangeSelectionBoundary,
    cloneBlockInfo,
    resolveBlockBoundaryAtLine,
} from './selection-model';
import {
    buildCommittedRangeSelection,
    buildCommittedRangeDeletionChanges,
    computeUpdatedSelectionState,
} from './selection-state';
import { autoScrollRangeSelection } from './selection-session-flow';
import { RangeSelectionVisualManager } from './selection-visual-manager';
import { InteractionState } from '../interaction/drag-interaction-state';

export function autoScrollSelectionRange(view: EditorView, clientY: number): void {
    const scroller = view.scrollDOM
        ?? view.dom.querySelector<HTMLElement>('.cm-scroller')
        ?? null;
    if (!scroller) return;
    autoScrollRangeSelection(scroller, clientY);
}

export function updateSelectionFromBoundary(
    view: EditorView,
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary,
    rangeVisual: RangeSelectionVisualManager
): void {
    const next = computeUpdatedSelectionState(view.state, state, target);
    state.currentLineNumber = next.currentLineNumber;
    state.selectionBlocks = next.selectionBlocks;
    state.activeSelectionBlock = next.activeSelectionBlock;
    rangeVisual.render(state.selectionBlocks);
}

export function updateSelectionFromLine(
    view: EditorView,
    state: MouseRangeSelectState,
    lineNumber: number,
    rangeVisual: RangeSelectionVisualManager
): void {
    const doc = view.state.doc;
    const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
    const boundary = resolveBlockBoundaryAtLine(view.state, clampedLine);
    updateSelectionFromBoundary(
        view,
        state,
        {
            ...boundary,
            representativeLineNumber: clampedLine,
        },
        rangeVisual
    );
}

export function commitSelectionRange(
    view: EditorView,
    state: MouseRangeSelectState,
    rangeVisual: RangeSelectionVisualManager
): CommittedRangeSelection | null {
    const committed = buildCommittedRangeSelection(
        view.state.doc,
        state.selectionBlocks,
        state.anchorSelectionBlock
    );
    if (!committed) {
        rangeVisual.clear();
        return null;
    }
    rangeVisual.render(committed.blocks);
    return committed;
}

export function clearCommittedSelectionRange(
    committed: CommittedRangeSelection | null,
    rangeVisual: RangeSelectionVisualManager
): CommittedRangeSelection | null {
    if (!committed) return committed;
    rangeVisual.clear();
    return null;
}

export function deleteCommittedSelectionRange(
    view: EditorView,
    committed: CommittedRangeSelection | null,
    rangeVisual: RangeSelectionVisualManager
): CommittedRangeSelection | null {
    if (!committed) return committed;
    const doc = view.state.doc;
    const changes = buildCommittedRangeDeletionChanges(doc, committed.blocks);
    if (changes.length > 0) {
        view.dispatch({ changes });
    }
    rangeVisual.clear();
    return null;
}

export function cloneCommittedSelectionBlock(committed: CommittedRangeSelection | null): BlockInfo | null {
    if (!committed) return null;
    return cloneBlockInfo(committed.selectedBlock);
}

export function refreshSelectionVisual(
    gesture: InteractionState,
    committed: CommittedRangeSelection | null,
    rangeVisual: RangeSelectionVisualManager
): void {
    if (gesture.phase === 'range_selecting') {
        rangeVisual.render(gesture.rangeSelect.selectionBlocks);
        return;
    }
    if (committed) {
        rangeVisual.render(committed.blocks);
    }
}




