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
        } = params;

        if (sourceView && sourceView !== this.deps.view && sourceDocumentRelation !== 'same_document') {
            moveBlockAcrossEditors({
                sourceView,
                targetView: this.deps.view,
                sourceBlock,
                targetPos,
                targetLineNumberOverride,
                listContextLineNumberOverride,
                listIndentDeltaOverride,
                listTargetIndentWidthOverride,
                deps: {
                    getAdjustedTargetLocation: this.deps.getAdjustedTargetLocation,
                    resolveDropRuleAtInsertion: this.deps.resolveDropRuleAtInsertion,
                    parseLineWithQuote: this.deps.parseLineWithQuote,
                    getListContext: this.deps.getListContext,
                    getIndentUnitWidth: this.deps.getIndentUnitWidth,
                    buildInsertText: this.deps.buildInsertText,
                },
            });
            return;
        }

        const compositeRanges = sourceBlock.compositeSelection?.ranges ?? [];
        if (compositeRanges.length > 1) {
            this.moveCompositeBlock(params);
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
            sourceBlock,
            targetLineNumber,
            { lineMap }
        );
        if (!containerRule.decision.allowDrop) {
            return;
        }

        const inPlaceValidation = validateInPlaceDrop({
            doc,
            sourceBlock,
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

        const sourceStartLine = doc.line(sourceBlock.startLine + 1);
        const sourceEndLine = doc.line(sourceBlock.endLine + 1);
        const sourceFrom = sourceStartLine.from;
        const sourceTo = sourceEndLine.to;
        const sourceContent = doc.sliceString(sourceFrom, sourceTo);
        const insertText = this.deps.buildInsertText(
            doc,
            sourceBlock,
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

        const sourceLineNumber = sourceBlock.startLine + 1;
        setTimeout(() => {
            this.listRenumberer.renumberOrderedListAround(sourceLineNumber);
            this.listRenumberer.renumberOrderedListAround(targetLineNumber);
        }, 0);
    }

    private moveCompositeBlock(params: {
        sourceBlock: BlockInfo;
        targetPos: number;
        targetLineNumberOverride?: number;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
    }): void {
        const { sourceBlock, targetPos, targetLineNumberOverride } = params;
        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const normalizedRanges = this.normalizeCompositeRanges(
            sourceBlock.compositeSelection?.ranges ?? [],
            doc.lines
        );
        if (normalizedRanges.length <= 1) {
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

        const insertText = segments
            .map((segment) => doc.sliceString(
                segment.sourceFrom,
                Math.min(segment.sourceTo + 1, doc.length)
            ))
            .join('');
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

        const renumberTargets = new Set<number>([targetLineNumber]);
        for (const segment of segments) {
            renumberTargets.add(segment.startLineNumber);
        }
        setTimeout(() => {
            for (const lineNumber of renumberTargets) {
                this.listRenumberer.renumberOrderedListAround(lineNumber);
            }
        }, 0);
    }

    private normalizeCompositeRanges(
        ranges: Array<{ startLine: number; endLine: number }>,
        totalLines: number
    ): Array<{ startLine: number; endLine: number }> {
        const normalized = ranges
            .map((range) => {
                const startLine = Math.max(0, Math.min(totalLines - 1, Math.min(range.startLine, range.endLine)));
                const endLine = Math.max(0, Math.min(totalLines - 1, Math.max(range.startLine, range.endLine)));
                return { startLine, endLine };
            })
            .sort((a, b) => a.startLine - b.startLine);

        const merged: Array<{ startLine: number; endLine: number }> = [];
        for (const range of normalized) {
            const last = merged[merged.length - 1];
            if (!last || range.startLine > last.endLine + 1) {
                merged.push(range);
            } else if (range.endLine > last.endLine) {
                last.endLine = range.endLine;
            }
        }
        return merged;
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


