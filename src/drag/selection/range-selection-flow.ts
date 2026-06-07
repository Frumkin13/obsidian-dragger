import { EditorView } from '@codemirror/view';
import { anchorSelectionBeforeUndoableChange } from '../../platform/codemirror/undo-selection-anchor';
import {
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    type RangeSelectionBoundary,
    resolveBlockBoundaryAtLine,
} from '../state/selection/selection-model';
import {
    buildCommittedRangeSelection,
    buildCommittedRangeDeletionChanges,
    computeUpdatedSelectionState,
} from '../state/selection/selection-state';
import { autoScrollNearViewportEdge } from '../input/auto-scroll';
import { RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import { InteractionState } from '../state/drag-state';

export function autoScrollSelectionRange(view: EditorView, clientY: number): boolean {
    const scroller = view.scrollDOM
        ?? view.dom.querySelector<HTMLElement>('.cm-scroller')
        ?? null;
    if (!scroller) return false;
    return autoScrollNearViewportEdge(scroller, clientY);
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
        state.anchorBlock
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
        anchorSelectionBeforeUndoableChange(view, committed.templateBlock.from);
        view.dispatch({ changes });
    }
    rangeVisual.clear();

    return null;
}

export function refreshSelectionVisual(
    gesture: InteractionState,
    committed: CommittedRangeSelection | null,
    rangeVisual: RangeSelectionVisualManager
): void {
    if (gesture.phase === 'selecting' && gesture.selection.mode === 'range') {
        rangeVisual.render(gesture.selection.rangeSelect.selectionBlocks);
        return;
    }
    if (gesture.phase === 'selecting' && gesture.selection.mode === 'mobile') {
        rangeVisual.render(gesture.selection.mobileSelect.selectedBlocks, { highlightLines: true, showMobileResizeHandles: true });
        return;
    }
    if (committed) {
        rangeVisual.render(committed.blocks);
    }
}
