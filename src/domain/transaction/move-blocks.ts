import type { BlockInfo } from '../block/block-types';
import type { DocLike, DocLikeWithRange, ListContext, ParsedLine } from '../markdown/document-types';
import type { DropTarget, ListDropTarget } from '../command/drop-target';
import { clampTargetLineNumber } from '../markdown/line-target-number';
import { getLineMap } from '../markdown/line-map';
import type { InsertionSlotContext } from '../rules/insertion-rules';
import { validateInPlaceDrop } from '../rules/drop-validation';
import { resolveDeleteRange, resolveInsertionChange } from '../mutation/document-change';
import { normalizeCompositeRanges, type CompositeLineRange } from '../selection/selection-ranges';
import { createBlockSelection, type BlockSelection } from '../selection/block-selection';
import type { BlockTransaction } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';

export type MoveSourceSegment = {
    startLineNumber: number;
    endLineNumber: number;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type MoveSourcePayload = {
    content: string;
    ranges: CompositeLineRange[];
    segments: MoveSourceSegment[];
};

export type CapturedMoveSource = {
    block: BlockInfo;
    payload: MoveSourcePayload;
};

export interface MoveBlocksPlannerDeps {
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options: { lineMap?: ReturnType<typeof getLineMap>; tabSize: number }
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
        listIntent?: ListDropTarget
    ) => string;
    tabSize: number;
}

export function captureMoveSource(doc: DocLikeWithRange, selection: BlockSelection): CapturedMoveSource | null {
    const payload = captureMoveSourcePayload(doc, selection);
    if (!payload) return null;

    const firstRange = payload.ranges[0];
    const lastRange = payload.ranges[payload.ranges.length - 1];
    const firstLine = doc.line(firstRange.startLine + 1);
    const lastLine = doc.line(lastRange.endLine + 1);

    return {
        block: {
            ...selection.anchorBlock,
            startLine: firstRange.startLine,
            endLine: lastRange.endLine,
            from: firstLine.from,
            to: lastLine.to,
            content: payload.content,
        },
        payload,
    };
}

export function captureMoveSourcePayload(doc: DocLikeWithRange, selection: BlockSelection): MoveSourcePayload | null {
    const ranges = normalizeCompositeRanges(selection.ranges, doc.lines);
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

export function planMoveBlocksTransaction(params: {
    doc: DocLikeWithRange;
    selection: BlockSelection;
    target: DropTarget;
    deps: MoveBlocksPlannerDeps;
}): BlockTransaction | CommandReject {
    const { doc, selection, target, deps } = params;
    const capturedSource = captureMoveSource(doc, selection);
    if (!capturedSource) return rejectCommand('empty_selection');
    return planCapturedMoveBlocksTransaction({
        doc,
        capturedSource,
        target,
        deps,
    });
}

export function planCapturedMoveBlocksTransaction(params: {
    doc: DocLikeWithRange;
    capturedSource: CapturedMoveSource;
    target: DropTarget;
    deps: MoveBlocksPlannerDeps;
    mode?: 'same-document' | 'insert-only';
}): BlockTransaction | CommandReject {
    const { doc, capturedSource, target, deps } = params;
    const { block: sourceBlock, payload } = capturedSource;
    const targetLineNumber = clampTargetLineNumber(doc.lines, target.targetLineNumber);
    const lineMap = getLineMap({ doc }, { tabSize: deps.tabSize });
    const containerRule = deps.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber, {
        lineMap,
        tabSize: deps.tabSize,
    });
    if (!containerRule.decision.allowDrop) {
        return rejectCommand(containerRule.decision.rejectReason ?? 'container_policy');
    }

    const mode = params.mode ?? 'same-document';
    if (mode === 'same-document') {
        const inPlaceValidation = validateInPlaceDrop({
            doc,
            source: createBlockSelection(sourceBlock, payload.ranges),
            targetLineNumber,
            parseLineWithQuote: deps.parseLineWithQuote,
            getListContext: deps.getListContext,
            getIndentUnitWidth: deps.getIndentUnitWidth,
            slotContext: containerRule.slotContext,
            lineMap,
            listIntent: target.listIntent,
        });
        const allowInPlaceIndentChange = inPlaceValidation.allowInPlaceIndentChange;
        if (inPlaceValidation.inSelfRange && !allowInPlaceIndentChange) {
            return rejectCommand(inPlaceValidation.rejectReason ?? 'self_range_blocked');
        }

        return planInsertionAndDeletionTransaction({
            doc,
            sourceBlock,
            payload,
            targetLineNumber,
            listIntent: target.listIntent,
            deps,
            allowInPlaceIndentChange,
        });
    }

    return planInsertOnlyTransaction({
        doc,
        sourceBlock,
        payload,
        targetLineNumber,
        listIntent: target.listIntent,
        deps,
    });
}

function planInsertionAndDeletionTransaction(params: {
    doc: DocLikeWithRange;
    sourceBlock: BlockInfo;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    listIntent?: ListDropTarget;
    deps: MoveBlocksPlannerDeps;
    allowInPlaceIndentChange: boolean;
}): BlockTransaction | CommandReject {
    const { doc, sourceBlock, payload, targetLineNumber, listIntent, deps, allowInPlaceIndentChange } = params;

    const insertText = deps.buildInsertText(
        doc,
        sourceBlock,
        targetLineNumber,
        payload.content,
        listIntent
    );
    if (!insertText.length) return rejectCommand('no_insert_text');

    const totalDeletedLength = payload.segments.reduce(
        (sum, segment) => sum + (segment.deleteTo - segment.deleteFrom),
        0
    );
    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length - totalDeletedLength,
    });
    if (payload.segments.some((segment) => insertion.pos > segment.deleteFrom && insertion.pos < segment.deleteTo)) {
        return rejectCommand('insertion_inside_deleted_range');
    }

    const firstSegment = payload.segments[0];
    const changes = allowInPlaceIndentChange && insertion.pos === firstSegment.deleteFrom
        ? [{ from: firstSegment.deleteFrom, to: firstSegment.deleteTo, insert: insertion.text }]
        : [
            { from: insertion.pos, to: insertion.pos, insert: insertion.text },
            ...payload.segments.map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo, insert: '' })),
        ].sort((a, b) => b.from - a.from);

    const finalInsertedStartLineNumber = resolveFinalInsertedStartLineNumber(targetLineNumber, payload);
    const renumberTargets = new Set<number>([targetLineNumber, finalInsertedStartLineNumber]);
    for (const segment of payload.segments) {
        renumberTargets.add(segment.startLineNumber);
    }

    return {
        changes,
        effects: [
            { type: 'restore-fold-state', lineNumber: finalInsertedStartLineNumber },
            ...Array.from(renumberTargets).map((lineNumber) => ({ type: 'renumber-ordered-list' as const, lineNumber })),
        ],
    };
}

function planInsertOnlyTransaction(params: {
    doc: DocLikeWithRange;
    sourceBlock: BlockInfo;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    listIntent?: ListDropTarget;
    deps: MoveBlocksPlannerDeps;
}): BlockTransaction | CommandReject {
    const { doc, sourceBlock, payload, targetLineNumber, listIntent, deps } = params;
    const insertText = deps.buildInsertText(
        doc,
        sourceBlock,
        targetLineNumber,
        payload.content,
        listIntent
    );
    if (!insertText.length) return rejectCommand('no_insert_text');

    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length,
    });
    const changes = [{ from: insertion.pos, to: insertion.pos, insert: insertion.text }];
    return {
        changes,
        effects: [
            { type: 'restore-fold-state', lineNumber: targetLineNumber },
            { type: 'renumber-ordered-list', lineNumber: targetLineNumber },
        ],
    };
}

export function resolveFinalInsertedStartLineNumber(targetLineNumber: number, payload: MoveSourcePayload): number {
    let removedLineCountBeforeTarget = 0;
    for (const segment of payload.segments) {
        if (segment.endLineNumber < targetLineNumber) {
            removedLineCountBeforeTarget += segment.endLineNumber - segment.startLineNumber + 1;
        }
    }
    return Math.max(1, targetLineNumber - removedLineCountBeforeTarget);
}
