import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../core/block/block-types';
import { validateInPlaceDrop } from '../../core/container-rules/drop-validation';
import { getLineMap } from '../../core/parser/line-map';
import { DocLikeWithRange } from '../../shared/types/protocol-types';
import { ListRenumberer } from './list-renumberer';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { moveBlockAcrossEditors } from './cross-editor-move';
import { DragDocumentRelation } from '../../shared/types/drag';
import { BlockMoverDeps } from './block-mover-deps';
import { CapturedBlockFoldState } from './block-fold-state';
import { normalizeCompositeRanges } from '../../shared/utils/composite-selection';

export class BlockMover {
    private readonly listRenumberer: ListRenumberer;

    constructor(private readonly deps: BlockMoverDeps) {
        this.listRenumberer = new ListRenumberer({
            view: deps.view,
            parseLineWithQuote: deps.parseLineWithQuote,
        });
    }

    moveBlock(params: {
        sourceBlock: BlockInfo;
        targetPos: number;
        targetLineNumberOverride?: number;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
        sourceView?: EditorView;
        sourceDocumentRelation?: DragDocumentRelation;
        capturedBlockFoldStateOverride?: CapturedBlockFoldState | null;
    }): void {
        const {
            sourceBlock,
            targetPos,
            targetLineNumberOverride,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
            sourceView,
            sourceDocumentRelation,
            capturedBlockFoldStateOverride,
        } = params;
        const sourceEditorView = sourceView ?? this.deps.view;
        const sourceDoc = sourceEditorView.state.doc as unknown as DocLikeWithRange;
        const normalizedSourceBlock = this.normalizeSourceBlock(sourceDoc, sourceBlock);

        if (sourceView && sourceView !== this.deps.view && sourceDocumentRelation !== 'same_document') {
            const capturedBlockFoldState = capturedBlockFoldStateOverride
                ?? this.captureBlockFoldState(sourceView, normalizedSourceBlock);
            moveBlockAcrossEditors({
                sourceView,
                targetView: this.deps.view,
                sourceBlock: normalizedSourceBlock,
                targetPos,
                targetLineNumberOverride,
                listContextLineNumberOverride,
                listIndentDeltaOverride,
                listTargetIndentWidthOverride,
                capturedBlockFoldState,
                deps: {
                    getAdjustedTargetLocation: this.deps.getAdjustedTargetLocation,
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

        const compositeRanges = normalizedSourceBlock.compositeSelection?.ranges ?? [];
        const capturedBlockFoldState = capturedBlockFoldStateOverride
            ?? this.captureBlockFoldState(sourceEditorView, normalizedSourceBlock);
        if (compositeRanges.length > 1) {
            this.moveCompositeBlock({
                ...params,
                sourceBlock: normalizedSourceBlock,
                sourceView,
                sourceDocumentRelation,
                capturedBlockFoldState,
            });
            return;
        }

        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const targetLine = view.state.doc.lineAt(targetPos);

        let targetLineNumber = targetLineNumberOverride ?? targetLine.number;

        if (targetLineNumberOverride === undefined) {
            const adjusted = this.deps.getAdjustedTargetLocation(targetLine.number);
            if (adjusted.blockAdjusted) {
                targetLineNumber = adjusted.lineNumber;
            }
        }

        targetLineNumber = clampTargetLineNumber(doc.lines, targetLineNumber);
        const lineMap = getLineMap(view.state);
        const containerRule = this.deps.resolveDropRuleAtInsertion(
            normalizedSourceBlock,
            targetLineNumber,
            { lineMap }
        );
        if (!containerRule.decision.allowDrop) {
            return;
        }

        const inPlaceValidation = validateInPlaceDrop({
            doc,
            sourceBlock: normalizedSourceBlock,
            targetLineNumber,
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getListContext: this.deps.getListContext,
            getIndentUnitWidth: this.deps.getIndentUnitWidth,
            slotContext: containerRule.slotContext,
            lineMap,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
        });
        const allowInPlaceIndentChange = inPlaceValidation.allowInPlaceIndentChange;
        if (inPlaceValidation.inSelfRange && !allowInPlaceIndentChange) {
            return;
        }

        const sourceStartLine = doc.line(normalizedSourceBlock.startLine + 1);
        const sourceEndLine = doc.line(normalizedSourceBlock.endLine + 1);
        const sourceFrom = sourceStartLine.from;
        const sourceTo = sourceEndLine.to;
        const sourceContent = doc.sliceString(sourceFrom, sourceTo);
        const insertText = this.deps.buildInsertText(
            doc,
            normalizedSourceBlock,
            targetLineNumber,
            sourceContent,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride
        );
        const deleteRange = this.resolveDeleteRange(doc, sourceFrom, sourceTo);
        const deleteFrom = deleteRange.from;
        const deleteTo = deleteRange.to;
        const insertion = this.resolveInsertionChange(doc, targetLineNumber, insertText, {
            remainingLengthAfterDelete: doc.length - (deleteTo - deleteFrom),
        });
        const insertPos = insertion.pos;

        const targetStartLineNumber = allowInPlaceIndentChange && insertPos === deleteFrom
            ? normalizedSourceBlock.startLine + 1
            : this.resolveFinalInsertedStartLineNumber(normalizedSourceBlock, targetLineNumber);

        if (allowInPlaceIndentChange && insertPos === deleteFrom) {
            view.dispatch({
                changes: { from: deleteFrom, to: deleteTo, insert: insertion.text },
                scrollIntoView: false,
            });
        } else {
            view.dispatch({
                changes: [
                    { from: insertPos, to: insertPos, insert: insertion.text },
                    { from: deleteFrom, to: deleteTo },
                ].sort((a, b) => b.from - a.from),
                scrollIntoView: false,
            });
        }

        const sourceLineNumber = normalizedSourceBlock.startLine + 1;
        this.listRenumberer.renumberOrderedListAround(sourceLineNumber);
        this.listRenumberer.renumberOrderedListAround(targetLineNumber);
        this.deps.blockFoldState?.restore(view, targetStartLineNumber, capturedBlockFoldState);
    }

    private moveCompositeBlock(params: {
        sourceBlock: BlockInfo;
        targetPos: number;
        targetLineNumberOverride?: number;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
        sourceView?: EditorView;
        sourceDocumentRelation?: DragDocumentRelation;
        capturedBlockFoldState?: CapturedBlockFoldState | null;
    }): void {
        const {
            sourceBlock,
            targetPos,
            targetLineNumberOverride,
            sourceView,
            sourceDocumentRelation,
            capturedBlockFoldState,
        } = params;
        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const normalizedRanges = normalizeCompositeRanges(
            sourceBlock.compositeSelection?.ranges ?? [],
            doc.lines
        );
        if (normalizedRanges.length <= 1) {
            this.moveBlock({
                sourceBlock,
                targetPos,
                targetLineNumberOverride: params.targetLineNumberOverride,
                listContextLineNumberOverride: params.listContextLineNumberOverride,
                listIndentDeltaOverride: params.listIndentDeltaOverride,
                listTargetIndentWidthOverride: params.listTargetIndentWidthOverride,
                sourceView,
                sourceDocumentRelation,
                capturedBlockFoldStateOverride: capturedBlockFoldState,
            });
            return;
        }

        const targetLine = view.state.doc.lineAt(targetPos);
        let targetLineNumber = targetLineNumberOverride ?? targetLine.number;
        if (targetLineNumberOverride === undefined) {
            const adjusted = this.deps.getAdjustedTargetLocation(targetLine.number);
            if (adjusted.blockAdjusted) {
                targetLineNumber = adjusted.lineNumber;
            }
        }
        targetLineNumber = clampTargetLineNumber(doc.lines, targetLineNumber);

        const lineMap = getLineMap(view.state);
        const containerRule = this.deps.resolveDropRuleAtInsertion(
            sourceBlock,
            targetLineNumber,
            { lineMap }
        );
        if (!containerRule.decision.allowDrop) {
            return;
        }
        if (this.isTargetInsideCompositeRanges(targetLineNumber, normalizedRanges)) {
            return;
        }

        const segments = normalizedRanges.map((range) => {
            const startLine = doc.line(range.startLine + 1);
            const endLine = doc.line(range.endLine + 1);
            const sourceFrom = startLine.from;
            const sourceTo = endLine.to;
            const deleteRange = this.resolveDeleteRange(doc, sourceFrom, sourceTo);
            return {
                sourceFrom,
                sourceTo,
                deleteFrom: deleteRange.from,
                deleteTo: deleteRange.to,
                startLineNumber: range.startLine + 1,
            };
        });

        const insertText = this.deps.buildInsertText(
            doc,
            sourceBlock,
            targetLineNumber,
            sourceBlock.content,
            params.listContextLineNumberOverride,
            params.listIndentDeltaOverride,
            params.listTargetIndentWidthOverride
        );
        if (!insertText.length) return;
        const totalDeletedLength = segments.reduce(
            (sum, segment) => sum + (segment.deleteTo - segment.deleteFrom),
            0
        );
        const insertion = this.resolveInsertionChange(doc, targetLineNumber, insertText, {
            remainingLengthAfterDelete: doc.length - totalDeletedLength,
        });
        if (segments.some((segment) => insertion.pos > segment.deleteFrom && insertion.pos < segment.deleteTo)) {
            return;
        }

        const changes = [
            { from: insertion.pos, to: insertion.pos, insert: insertion.text },
            ...segments.map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo })),
        ].sort((a, b) => b.from - a.from);

        view.dispatch({
            changes,
            scrollIntoView: false,
        });

        const targetStartLineNumber = this.resolveFinalCompositeInsertedStartLineNumber(targetLineNumber, normalizedRanges);
        const renumberTargets = new Set<number>([targetLineNumber]);
        for (const segment of segments) {
            renumberTargets.add(segment.startLineNumber);
        }
        for (const lineNumber of renumberTargets) {
            this.listRenumberer.renumberOrderedListAround(lineNumber);
        }
        this.deps.blockFoldState?.restore(view, targetStartLineNumber, capturedBlockFoldState ?? null);
    }

    private isTargetInsideCompositeRanges(
        targetLineNumber: number,
        ranges: Array<{ startLine: number; endLine: number }>
    ): boolean {
        const targetLine0 = targetLineNumber - 1;
        for (const range of ranges) {
            if (targetLine0 >= range.startLine && targetLine0 <= range.endLine) {
                return true;
            }
        }
        return false;
    }

    private captureBlockFoldState(sourceView: EditorView, sourceBlock: BlockInfo): CapturedBlockFoldState | null {
        return this.deps.blockFoldState?.capture(sourceView, sourceBlock) ?? null;
    }

    private normalizeSourceBlock(doc: DocLikeWithRange, sourceBlock: BlockInfo): BlockInfo {
        const compositeRanges = normalizeCompositeRanges(
            sourceBlock.compositeSelection?.ranges ?? [],
            doc.lines
        );
        if (compositeRanges.length === 0) {
            return sourceBlock;
        }

        const firstRange = compositeRanges[0];
        const lastRange = compositeRanges[compositeRanges.length - 1];
        const firstLine = doc.line(firstRange.startLine + 1);
        const lastLine = doc.line(lastRange.endLine + 1);
        const content = compositeRanges
            .map((range) => {
                const startLine = doc.line(range.startLine + 1);
                const endLine = doc.line(range.endLine + 1);
                return doc.sliceString(startLine.from, endLine.to);
            })
            .join('\n');

        return {
            ...sourceBlock,
            startLine: firstRange.startLine,
            endLine: lastRange.endLine,
            from: firstLine.from,
            to: lastLine.to,
            content,
            compositeSelection: compositeRanges.length > 1
                ? { ranges: compositeRanges }
                : undefined,
        };
    }

    private resolveFinalInsertedStartLineNumber(sourceBlock: BlockInfo, targetLineNumber: number): number {
        const sourceStartLineNumber = sourceBlock.startLine + 1;
        const sourceLineCount = sourceBlock.endLine - sourceBlock.startLine + 1;
        if (sourceStartLineNumber < targetLineNumber) {
            return Math.max(1, targetLineNumber - sourceLineCount);
        }
        return targetLineNumber;
    }

    private resolveFinalCompositeInsertedStartLineNumber(
        targetLineNumber: number,
        ranges: Array<{ startLine: number; endLine: number }>
    ): number {
        let removedLineCountBeforeTarget = 0;
        for (const range of ranges) {
            const startLineNumber = range.startLine + 1;
            const endLineNumber = range.endLine + 1;
            if (endLineNumber < targetLineNumber) {
                removedLineCountBeforeTarget += endLineNumber - startLineNumber + 1;
            }
        }
        return Math.max(1, targetLineNumber - removedLineCountBeforeTarget);
    }

    private resolveInsertionChange(
        doc: DocLikeWithRange,
        targetLineNumber: number,
        insertText: string,
        options?: {
            remainingLengthAfterDelete?: number;
        }
    ): { pos: number; text: string } {
        if (targetLineNumber <= doc.lines) {
            return {
                pos: doc.line(targetLineNumber).from,
                text: insertText,
            };
        }
        const normalized = insertText.endsWith('\n')
            ? insertText.slice(0, -1)
            : insertText;
        if (!normalized.length) {
            return { pos: doc.length, text: normalized };
        }
        const remainingLengthAfterDelete = options?.remainingLengthAfterDelete ?? doc.length;
        if (remainingLengthAfterDelete <= 0) {
            return { pos: 0, text: normalized };
        }
        return {
            pos: doc.length,
            text: `\n${normalized}`,
        };
    }

    private resolveDeleteRange(
        doc: DocLikeWithRange,
        sourceFrom: number,
        sourceTo: number
    ): { from: number; to: number } {
        if (sourceTo < doc.length) {
            return {
                from: sourceFrom,
                to: Math.min(sourceTo + 1, doc.length),
            };
        }

        if (sourceFrom > 0) {
            return {
                from: sourceFrom - 1,
                to: sourceTo,
            };
        }

        return {
            from: sourceFrom,
            to: sourceTo,
        };
    }
}


