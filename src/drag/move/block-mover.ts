import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import { detectBlock } from '../../domain/block/block-detector';
import { validateInPlaceDrop } from '../../domain/rules/drop-validation';
import { getLineMap } from '../../domain/markdown/line-map';
import { getNextNonEmptyLineNumber } from '../../domain/rules/container-policy';
import { DocLikeWithRange, DropPlan } from '../../shared/types/protocol-types';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { ListRenumberer } from './list-renumberer';
import { moveBlockAcrossEditors } from './cross-editor-mover';
import { DragDocumentRelation, DragSource } from '../../shared/types/drag';
import { BlockMoverDeps } from './block-mover-deps';
import { CapturedBlockFoldState } from './block-fold-state';
import { resolveInsertionChange } from './document-change';
import { CapturedMoveSource, captureMoveSource } from './source-payload';
import { anchorSelectionBeforeUndoableChange } from '../../platform/codemirror/undo-selection-anchor';

export class BlockMover {
    private readonly listRenumberer: ListRenumberer;

    constructor(private readonly deps: BlockMoverDeps) {
        this.listRenumberer = new ListRenumberer({
            view: deps.view,
            parseLineWithQuote: deps.parseLineWithQuote,
        });
    }

    moveBlock(params: {
        source: DragSource;
        dropPlan: DropPlan;
        sourceView?: EditorView;
        sourceDocumentRelation?: DragDocumentRelation;
        capturedBlockFoldStateOverride?: CapturedBlockFoldState | null;
    }): void {
        const {
            source,
            dropPlan,
            sourceView,
            sourceDocumentRelation,
            capturedBlockFoldStateOverride,
        } = params;
        const sourceEditorView = sourceView ?? this.deps.view;
        const sourceDoc = sourceEditorView.state.doc as unknown as DocLikeWithRange;
        const capturedSource = captureMoveSource(sourceDoc, source);
        if (!capturedSource) return;

        if (sourceView && sourceView !== this.deps.view && sourceDocumentRelation !== 'same_document') {
            const capturedBlockFoldState = capturedBlockFoldStateOverride
                ?? this.captureBlockFoldState(sourceView, capturedSource.block);
            moveBlockAcrossEditors({
                sourceView,
                targetView: this.deps.view,
                sourceBlock: capturedSource.block,
                sourcePayload: capturedSource.payload,
                dropPlan,
                capturedBlockFoldState,
                deps: {
                    resolveDropRuleAtInsertion: this.deps.resolveDropRuleAtInsertion,
                    parseLineWithQuote: this.deps.parseLineWithQuote,
                    getListContext: this.deps.getListContext,
                    getIndentUnitWidth: this.deps.getIndentUnitWidth,
                    buildInsertText: this.deps.buildInsertText,
                    blockFoldState: this.deps.blockFoldState,
                },
            });
            return;
        }

        const capturedBlockFoldState = capturedBlockFoldStateOverride
            ?? this.captureBlockFoldState(sourceEditorView, capturedSource.block);
        this.moveCapturedSource({
            source: capturedSource,
            dropPlan,
            capturedBlockFoldState,
            preserveDisplacedTargetFoldState: source.ranges.length <= 1,
        });
    }

    private moveCapturedSource(params: {
        source: CapturedMoveSource;
        dropPlan: DropPlan;
        capturedBlockFoldState?: CapturedBlockFoldState | null;
        preserveDisplacedTargetFoldState: boolean;
    }): void {
        const { source, dropPlan, capturedBlockFoldState, preserveDisplacedTargetFoldState } = params;
        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const { block: sourceBlock, payload } = source;
        const targetLineNumber = clampTargetLineNumber(doc.lines, dropPlan.targetLineNumber);
        const lineMap = getLineMap(view.state);
        const containerRule = this.deps.resolveDropRuleAtInsertion(
            sourceBlock,
            targetLineNumber,
            { lineMap }
        );
        if (!containerRule.decision.allowDrop) {
            return;
        }

        const inPlaceValidation = validateInPlaceDrop({
            doc,
            source: {
                primaryBlock: sourceBlock,
                ranges: payload.ranges,
            },
            targetLineNumber,
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getListContext: this.deps.getListContext,
            getIndentUnitWidth: this.deps.getIndentUnitWidth,
            slotContext: containerRule.slotContext,
            lineMap,
            listIntent: dropPlan.listIntent,
        });
        const allowInPlaceIndentChange = inPlaceValidation.allowInPlaceIndentChange;
        if (inPlaceValidation.inSelfRange && !allowInPlaceIndentChange) {
            return;
        }

        const insertText = this.deps.buildInsertText(
            doc,
            sourceBlock,
            targetLineNumber,
            payload.content,
            dropPlan.listIntent
        );
        if (!insertText.length) return;

        const totalDeletedLength = payload.segments.reduce(
            (sum, segment) => sum + (segment.deleteTo - segment.deleteFrom),
            0
        );
        const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
            remainingLengthAfterDelete: doc.length - totalDeletedLength,
        });
        if (payload.segments.some((segment) => insertion.pos > segment.deleteFrom && insertion.pos < segment.deleteTo)) {
            return;
        }

        const firstSegment = payload.segments[0];
        const displacedTargetFoldState = preserveDisplacedTargetFoldState
            ? this.captureDisplacedTargetFoldState({
                sourceBlock,
                targetLineNumber,
                insertedLineCount: this.countInsertedLines(insertion.text),
            })
            : null;
        anchorSelectionBeforeUndoableChange(view, sourceBlock.from);
        if (allowInPlaceIndentChange && insertion.pos === firstSegment.deleteFrom) {
            view.dispatch({
                changes: { from: firstSegment.deleteFrom, to: firstSegment.deleteTo, insert: insertion.text },
                scrollIntoView: false,
            });
        } else {
            view.dispatch({
                changes: [
                    { from: insertion.pos, to: insertion.pos, insert: insertion.text },
                    ...payload.segments.map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo })),
                ].sort((a, b) => b.from - a.from),
                scrollIntoView: false,
            });
        }

        const targetStartLineNumber = allowInPlaceIndentChange && insertion.pos === firstSegment.deleteFrom
            ? sourceBlock.startLine + 1
            : this.resolveFinalInsertedStartLineNumber(targetLineNumber, payload);
        const renumberTargets = new Set<number>([targetLineNumber]);
        for (const segment of payload.segments) {
            renumberTargets.add(segment.startLineNumber);
        }
        for (const lineNumber of renumberTargets) {
            this.listRenumberer.renumberOrderedListAround(lineNumber);
        }
        this.deps.blockFoldState?.restore(view, targetStartLineNumber, capturedBlockFoldState ?? null);
        if (displacedTargetFoldState) {
            this.deps.blockFoldState?.restore(
                view,
                displacedTargetFoldState.targetStartLineNumber,
                displacedTargetFoldState.foldState
            );
        }
    }

    private captureBlockFoldState(sourceView: EditorView, sourceBlock: BlockInfo): CapturedBlockFoldState | null {
        return this.deps.blockFoldState?.capture(sourceView, sourceBlock) ?? null;
    }

    private captureDisplacedTargetFoldState(params: {
        sourceBlock: BlockInfo;
        targetLineNumber: number;
        insertedLineCount: number;
    }): { targetStartLineNumber: number; foldState: CapturedBlockFoldState } | null {
        if (!this.deps.blockFoldState) return null;
        const { sourceBlock, targetLineNumber, insertedLineCount } = params;
        const targetBlock = this.resolveDisplacedTargetBlock(targetLineNumber);
        if (!targetBlock) return null;
        if (sourceBlock.startLine <= targetBlock.startLine) return null;

        const foldState = this.deps.blockFoldState.capture(this.deps.view, targetBlock);
        if (!foldState) return null;
        return {
            targetStartLineNumber: targetBlock.startLine + 1 + insertedLineCount,
            foldState,
        };
    }

    private resolveDisplacedTargetBlock(targetLineNumber: number): BlockInfo | null {
        const state = this.deps.view.state;
        const doc = state.doc;
        if (targetLineNumber < 1 || targetLineNumber > doc.lines) return null;

        const targetBlock = detectBlock(state, targetLineNumber);
        if (targetBlock) {
            return targetLineNumber === targetBlock.startLine + 1
                ? targetBlock
                : null;
        }

        const lineMap = getLineMap(state);
        const nextNonEmptyLineNumber = getNextNonEmptyLineNumber(doc, targetLineNumber, lineMap);
        if (nextNonEmptyLineNumber === null) return null;
        const nextBlock = detectBlock(state, nextNonEmptyLineNumber);
        if (!nextBlock || nextNonEmptyLineNumber !== nextBlock.startLine + 1) return null;
        return nextBlock;
    }

    private countInsertedLines(insertText: string): number {
        return insertText.split('\n').length - 1;
    }

    private resolveFinalInsertedStartLineNumber(targetLineNumber: number, payload: CapturedMoveSource['payload']): number {
        let removedLineCountBeforeTarget = 0;
        for (const segment of payload.segments) {
            if (segment.endLineNumber < targetLineNumber) {
                removedLineCountBeforeTarget += segment.endLineNumber - segment.startLineNumber + 1;
            }
        }
        return Math.max(1, targetLineNumber - removedLineCountBeforeTarget);
    }
}
