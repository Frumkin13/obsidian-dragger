import type { DocLikeWithRange } from '../markdown/document-types';
import type { DeleteBlockCommand } from '../command/delete-command';
import type { MoveBlockCommand } from '../command/move-command';
import type { BlockCommand } from '../command/block-command';
import type { BlockTransaction } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';
import { planDeleteBlocksTransaction } from './delete-blocks';
import {
    planCapturedMoveBlocksTransaction,
    planMoveBlocksTransaction,
    type CapturedMoveSource,
    type MoveBlocksPlannerDeps,
} from './move-blocks';

export function planBlockCommandTransaction(params: {
    doc: DocLikeWithRange;
    command: BlockCommand;
    deps?: MoveBlocksPlannerDeps;
}): BlockTransaction | CommandReject {
    const { doc, command, deps } = params;
    if (command.type === 'delete') {
        return planDeleteCommandTransaction({ doc, command });
    }

    if (command.type !== 'move') return rejectCommand('unsupported_command');
    if (!deps) return rejectCommand('missing_move_planner_deps');
    return planMoveCommandTransaction({ doc, command, deps });
}

export function planDeleteCommandTransaction(params: {
    doc: DocLikeWithRange;
    command: DeleteBlockCommand;
}): BlockTransaction | CommandReject {
    const { doc, command } = params;
    return planDeleteBlocksTransaction({
        doc,
        selection: command.selection,
    });
}

export function planMoveCommandTransaction(params: {
    doc: DocLikeWithRange;
    command: MoveBlockCommand;
    deps: MoveBlocksPlannerDeps;
}): BlockTransaction | CommandReject {
    const { doc, command, deps } = params;
    return planMoveBlocksTransaction({
        doc,
        selection: command.selection,
        target: command.target,
        deps,
    });
}

export function planCapturedMoveCommandTransaction(params: {
    doc: DocLikeWithRange;
    capturedSource: CapturedMoveSource;
    command: MoveBlockCommand;
    deps: MoveBlocksPlannerDeps;
    mode?: 'same-document' | 'insert-only';
}): BlockTransaction | CommandReject {
    const { doc, capturedSource, command, deps, mode } = params;
    return planCapturedMoveBlocksTransaction({
        doc,
        capturedSource,
        target: command.target,
        deps,
        mode,
    });
}
