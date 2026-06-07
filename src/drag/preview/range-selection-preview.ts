import { EditorView } from '@codemirror/view';
import { autoScrollNearViewportEdge } from '../input/auto-scroll';
import type { InteractionState } from '../state/drag-state';
import type { CommittedRangeSelection } from '../state/selection/selection-model';
import { RangeSelectionVisualManager } from './range-selection-visual-manager';

export function autoScrollEditorNearViewportEdge(view: EditorView, clientY: number): boolean {
    const scroller = view.scrollDOM
        ?? view.dom.querySelector<HTMLElement>('.cm-scroller')
        ?? null;
    if (!scroller) return false;
    return autoScrollNearViewportEdge(scroller, clientY);
}

export function renderRangeSelectionPreview(
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

export function renderCommittedRangeSelectionPreview(
    committed: CommittedRangeSelection | null,
    rangeVisual: RangeSelectionVisualManager
): void {
    if (!committed) {
        rangeVisual.clear();
        return;
    }
    rangeVisual.render(committed.blocks);
}
