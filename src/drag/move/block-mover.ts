import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import { InsertionSlotContext } from '../../domain/rules/insertion-rules';
import { detectBlock } from '../../domain/block/block-detector';
import { validateInPlaceDrop } from '../../domain/rules/drop-validation';
import { getLineMap } from '../../domain/markdown/line-map';
import { getNextNonEmptyLineNumber } from '../../domain/rules/container-policy';
import { DocLikeWithRange, DocLike, DropPlan, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { normalizeCompositeRanges, type CompositeLineRange } from '../../shared/utils/composite-selection';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { buildCommittedRangeDeletionChanges, type CommittedRangeSelection } from '../state/range-selection-state';
import { DragDocumentRelation, DragSource } from '../../shared/types/drag';
import { CapturedBlockFoldState, BlockFoldStateManager } from './block-fold-state';
import { resolveDeleteRange, resolveInsertionChange } from '../../domain/mutation/document-change';
import { anchorSelectionBeforeUndoableChange } from '../../platform/codemirror/undo-selection-anchor';

export interface BlockMoverDeps {
    view: EditorView;
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: ReturnType<typeof getLineMap> }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: string | null };
    };
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    buildInsertText: (
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listIntent?: DropPlan['listIntent']
    ) => string;
    blockFoldState?: BlockFoldStateManager;
}

export type SourceSegment = {
    startLineNumber: number;
    endLineNumber: number;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type SourcePayload = {
    content: string;
    ranges: CompositeLineRange[];
    segments: SourceSegment[];
};

export type CapturedMoveSource = {
    block: BlockInfo;
    payload: SourcePayload;
};

export interface ListRenumbererDeps {
    view: EditorView;
    parseLineWithQuote: (line: string) => ParsedLine;
}

export class ListRenumberer {
    constructor(private readonly deps: ListRenumbererDeps) { }

    renumberOrderedListAround(lineNumber: number): void {
        const view = this.deps.view;
        const doc = view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) return;

        const findOrderedAt = (n: number) => {
            const text = doc.line(n).text;
            const parsed = this.deps.parseLineWithQuote(text);
            if (parsed.isListItem && parsed.markerType === 'ordered') {
                return { indentWidth: parsed.indentWidth, quoteDepth: parsed.quoteDepth };
            }
            return null;
        };

        let anchor = findOrderedAt(lineNumber);
        if (!anchor && lineNumber > 1) anchor = findOrderedAt(lineNumber - 1);
        if (!anchor && lineNumber < doc.lines) anchor = findOrderedAt(lineNumber + 1);
        if (!anchor) return;

        let start = lineNumber;
        while (start > 1) {
            const info = findOrderedAt(start - 1);
            if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
            start -= 1;
        }

        let end = lineNumber;
        while (end < doc.lines) {
            const info = findOrderedAt(end + 1);
            if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
            end += 1;
        }

        const changes: { from: number; to: number; insert: string }[] = [];
        let number = 1;
        for (let i = start; i <= end; i++) {
            const line = doc.line(i);
            const parsed = this.deps.parseLineWithQuote(line.text);
            if (!parsed.isListItem || parsed.markerType !== 'ordered' || parsed.indentWidth !== anchor.indentWidth) continue;

            const newMarker = `${number}. `;
            const markerStart = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
            const markerEnd = markerStart + parsed.marker.length;
            changes.push({ from: markerStart, to: markerEnd, insert: newMarker });
            number += 1;
        }

        if (changes.length > 0) {
            view.dispatch({ changes });
        }
    }
}

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

export function captureMoveSource(doc: DocLikeWithRange, source: DragSource): CapturedMoveSource | null {
    const payload = captureSourcePayload(doc, source);
    if (!payload) return null;

    const firstRange = payload.ranges[0];
    const lastRange = payload.ranges[payload.ranges.length - 1];
    const firstLine = doc.line(firstRange.startLine + 1);
    const lastLine = doc.line(lastRange.endLine + 1);

    return {
        block: {
            ...source.primaryBlock,
            startLine: firstRange.startLine,
            endLine: lastRange.endLine,
            from: firstLine.from,
            to: lastLine.to,
            content: payload.content,
        },
        payload,
    };
}

export function captureSourcePayload(doc: DocLikeWithRange, source: DragSource): SourcePayload | null {
    const ranges = normalizeCompositeRanges(source.ranges, doc.lines);
    if (ranges.length === 0) return null;

    const segments = ranges.map((range) => {
        const startLineNumber = range.startLine + 1;
        const endLineNumber = range.endLine + 1;
        const startLine = doc.line(startLineNumber);
        const endLine = doc.line(endLineNumber);
        const deleteRange = resolveDeleteRange(doc, startLine.from, endLine.to);
        return {
            startLineNumber,
            endLineNumber,
            from: startLine.from,
            to: endLine.to,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
        };
    });
    const content = segments
        .map((segment) => doc.sliceString(segment.from, segment.to))
        .join('\n');

    return { content, ranges, segments };
}

export interface CrossEditorMoveDeps {
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: ReturnType<typeof getLineMap> }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: string | null };
    };
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    buildInsertText: (
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listIntent?: DropPlan['listIntent']
    ) => string;
    blockFoldState?: Pick<BlockFoldStateManager, 'restore'>;
}

export type CrossEditorMoveParams = {
    sourceView: EditorView;
    targetView: EditorView;
    sourceBlock: BlockInfo;
    sourcePayload: SourcePayload;
    dropPlan: DropPlan;
    capturedBlockFoldState?: CapturedBlockFoldState | null;
    deps: CrossEditorMoveDeps;
};

export function moveBlockAcrossEditors(params: CrossEditorMoveParams): void {
    const {
        sourceView,
        targetView,
        sourceBlock,
        sourcePayload,
        dropPlan,
        capturedBlockFoldState,
        deps,
    } = params;
    if (sourceView === targetView) return;

    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    const targetLineNumber = clampTargetLineNumber(targetDoc.lines, dropPlan.targetLineNumber);
    const lineMap = getLineMap(targetView.state);
    const containerRule = deps.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber, { lineMap });
    if (!containerRule.decision.allowDrop) {
        return;
    }

    const insertText = deps.buildInsertText(
        targetDoc,
        sourceBlock,
        targetLineNumber,
        sourcePayload.content,
        dropPlan.listIntent
    );
    if (!insertText.length) {
        return;
    }

    const insertion = resolveInsertionChange(targetDoc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: targetDoc.length,
    });

    anchorSelectionBeforeUndoableChange(targetView, insertion.pos);
    targetView.dispatch({
        changes: { from: insertion.pos, to: insertion.pos, insert: insertion.text },
        scrollIntoView: false,
    });

    anchorSelectionBeforeUndoableChange(sourceView, sourceBlock.from);
    sourceView.dispatch({
        changes: sourcePayload.segments
            .map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo }))
            .sort((a, b) => b.from - a.from),
        scrollIntoView: false,
    });

    finalizeMove({
        sourceView,
        targetView,
        sourceLineNumbers: sourcePayload.segments.map((segment) => segment.startLineNumber),
        targetLineNumbers: [targetLineNumber],
        parseLineWithQuote: deps.parseLineWithQuote,
        restoreTargetBlockFoldState: () => deps.blockFoldState?.restore(targetView, targetLineNumber, capturedBlockFoldState ?? null),
    });
}

function finalizeMove(params: {
    sourceView: EditorView;
    targetView: EditorView;
    sourceLineNumbers: number[];
    targetLineNumbers: number[];
    parseLineWithQuote: (line: string) => ParsedLine;
    restoreTargetBlockFoldState?: () => void;
}): void {
    const {
        sourceView,
        targetView,
        sourceLineNumbers,
        targetLineNumbers,
        parseLineWithQuote,
        restoreTargetBlockFoldState,
    } = params;
    const sourceRenumberer = new ListRenumberer({ view: sourceView, parseLineWithQuote });
    const targetRenumberer = new ListRenumberer({ view: targetView, parseLineWithQuote });
    const sourceTargets = new Set<number>(sourceLineNumbers);
    const targetTargets = new Set<number>(targetLineNumbers);

    for (const lineNumber of sourceTargets) {
        sourceRenumberer.renumberOrderedListAround(lineNumber);
    }
    for (const lineNumber of targetTargets) {
        targetRenumberer.renumberOrderedListAround(lineNumber);
    }
    restoreTargetBlockFoldState?.();
}

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
