import type { BlockSelection } from '../../../domain/selection/block-selection';
import { createMoveCommand, type MoveBlockCommand } from '../../../domain/command/move-command';
import type { DragDocumentRelation, DragSelectionScope, DropAllowedResult, DropRejectReason, DropValidationResult } from '../drop/codemirror-drop-snapshot';

export type MoveCommandDecision =
    | {
        type: 'cancel';
        targetLine: number | null;
        rejectReason: DropRejectReason | 'cross_document_disabled';
        validation: DropValidationResult;
    }
    | {
        type: 'commit';
        command: MoveBlockCommand;
        targetLine: number;
        validation: DropAllowedResult;
    };

export function buildMoveCommandDecision(params: {
    selection: BlockSelection;
    validation: DropValidationResult;
    sourceScope: DragSelectionScope;
    sourceDocumentRelation: DragDocumentRelation;
    crossFileDragEnabled: boolean;
}): MoveCommandDecision {
    const {
        selection,
        validation,
        sourceScope,
        sourceDocumentRelation,
        crossFileDragEnabled,
    } = params;

    if (
        sourceScope === 'cross_editor'
        && sourceDocumentRelation === 'different_document'
        && !crossFileDragEnabled
    ) {
        return {
            type: 'cancel',
            targetLine: null,
            rejectReason: 'cross_document_disabled',
            validation,
        };
    }

    if (!validation.allowed) {
        return {
            type: 'cancel',
            targetLine: null,
            rejectReason: validation.reason ?? 'no_target',
            validation,
        };
    }

    return {
        type: 'commit',
        command: createMoveCommand(selection, validation.resolution.target),
        targetLine: validation.resolution.target.targetLineNumber,
        validation,
    };
}
