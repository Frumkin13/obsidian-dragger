import { EditorView } from '@codemirror/view';
import type { CommittedRangeSelection } from '../../../domain/selection/range-selection';
import { createDeleteCommand } from '../../../domain/command/delete-command';
import { createBlockSelection } from '../../../domain/selection/block-selection';
import { planBlockCommandTransaction } from '../../../domain/transaction/block-command-transaction';
import type { CommandReject } from '../../../domain/transaction/command-reject';
import { applyBlockTransaction } from '../transaction/transaction-applier';

export function deleteCommittedRangeSelectionFromDocument(
    view: EditorView,
    committed: CommittedRangeSelection | null
): boolean {
    if (!committed) return false;
    const selection = createBlockSelection(
        committed.templateBlock,
        committed.blocks.map((block) => ({
            startLine: block.startLineNumber - 1,
            endLine: block.endLineNumber - 1,
        }))
    );
    const transaction = planBlockCommandTransaction({
        doc: view.state.doc,
        command: createDeleteCommand(selection),
    });
    if (isCommandReject(transaction)) return false;
    applyBlockTransaction(view, transaction, { anchor: committed.templateBlock.from });
    return true;
}

function isCommandReject(value: unknown): value is CommandReject {
    return typeof value === 'object'
        && value !== null
        && 'type' in value
        && value.type === 'reject';
}
