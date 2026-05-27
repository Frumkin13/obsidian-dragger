import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function anchorSelectionBeforeUndoableChange(view: EditorView, pos: number): void {
    const docLength = view.state.doc.length;
    const anchor = Math.max(0, Math.min(docLength, pos));

    view.dispatch({
        selection: { anchor },
        scrollIntoView: false,
        annotations: Transaction.addToHistory.of(false),
    });
}
