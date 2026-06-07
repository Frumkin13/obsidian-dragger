import { EditorView } from '@codemirror/view';
import { anchorSelectionBeforeUndoableChange } from '../../platform/codemirror/undo-selection-anchor';
import type { CommittedRangeSelection } from '../state/selection/selection-model';
import { buildCommittedRangeDeletionChanges } from '../state/selection/selection-state';

export function deleteCommittedRangeSelectionFromDocument(
    view: EditorView,
    committed: CommittedRangeSelection | null
): boolean {
    if (!committed) return false;
    const changes = buildCommittedRangeDeletionChanges(view.state.doc, committed.blocks);
    if (changes.length === 0) return false;
    anchorSelectionBeforeUndoableChange(view, committed.templateBlock.from);
    view.dispatch({ changes });
    return true;
}
