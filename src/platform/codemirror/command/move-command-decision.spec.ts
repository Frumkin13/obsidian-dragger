import { describe, expect, it } from 'vitest';
import { BlockType } from '../../../domain/block/block-types';
import { createSingleBlockSelection } from '../../../domain/selection/block-selection';
import { buildMoveCommandDecision } from './move-command-decision';
import type { DropValidationResult } from '../drop/drop-resolution';

function createSelection() {
    return createSingleBlockSelection({
        type: BlockType.Paragraph,
        startLine: 0,
        endLine: 0,
        from: 0,
        to: 5,
        indentLevel: 0,
        content: 'alpha',
    });
}

function allowedValidation(): DropValidationResult {
    return {
        allowed: true,
        resolution: {
            target: {
                targetLineNumber: 3,
                placement: 'before',
                listIntent: {
                    mode: 'child',
                    contextLineNumber: 2,
                    targetIndentWidth: 4,
                },
            },
            preview: {
                indicatorY: 20,
                lineRect: { left: 10, width: 80 },
            },
        },
    };
}

describe('buildMoveCommandDecision', () => {
    it('cancels cross-document drops when the setting is disabled', () => {
        const validation = allowedValidation();
        const decision = buildMoveCommandDecision({
            selection: createSelection(),
            validation,
            sourceScope: 'cross_editor',
            sourceDocumentRelation: 'different_document',
            crossFileDragEnabled: false,
        });

        expect(decision).toEqual({
            type: 'cancel',
            targetLine: null,
            rejectReason: 'cross_document_disabled',
            validation,
        });
    });

    it('converts an allowed validated drop into a move command', () => {
        const selection = createSelection();
        const validation = allowedValidation();
        const decision = buildMoveCommandDecision({
            selection,
            validation,
            sourceScope: 'same_editor',
            sourceDocumentRelation: 'same_document',
            crossFileDragEnabled: false,
        });

        expect(decision.type).toBe('commit');
        if (decision.type !== 'commit') return;
        expect(decision.targetLine).toBe(3);
        expect(decision.command).toEqual({
            type: 'move',
            selection,
            target: {
                targetLineNumber: 3,
                placement: 'before',
                listIntent: {
                    mode: 'child',
                    contextLineNumber: 2,
                    targetIndentWidth: 4,
                },
            },
        });
    });

    it('cancels rejected drop validation without creating a command', () => {
        const validation: DropValidationResult = {
            allowed: false,
            reason: 'no_target',
        };
        const decision = buildMoveCommandDecision({
            selection: createSelection(),
            validation,
            sourceScope: 'same_editor',
            sourceDocumentRelation: 'same_document',
            crossFileDragEnabled: false,
        });

        expect(decision).toEqual({
            type: 'cancel',
            targetLine: null,
            rejectReason: 'no_target',
            validation,
        });
    });
});
