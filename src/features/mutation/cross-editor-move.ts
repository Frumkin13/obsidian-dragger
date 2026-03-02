import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../core/block/block-types';
import { InsertionSlotContext } from '../../core/container-rules/insertion-rules';
import { getLineMap, LineMap } from '../../core/parser/line-map';
import { DocLike, DocLikeWithRange, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { ListRenumberer } from './list-renumberer';

export interface CrossEditorMoveDeps {
    getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) => { lineNumber: number; blockAdjusted: boolean };
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: LineMap }
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
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ) => string;
}

export type CrossEditorMoveParams = {
    sourceView: EditorView;
    targetView: EditorView;
    sourceBlock: BlockInfo;
    targetPos: number;
    targetLineNumberOverride?: number;
    listContextLineNumberOverride?: number;
    listIndentDeltaOverride?: number;
    listTargetIndentWidthOverride?: number;
    deps: CrossEditorMoveDeps;
};

export function moveBlockAcrossEditors(params: CrossEditorMoveParams): void {
    const {
        sourceView,
        targetView,
        sourceBlock,
    } = params;
    if (sourceView === targetView) return;

    const compositeRanges = sourceBlock.compositeSelection?.ranges ?? [];
    if (compositeRanges.length > 1) {
        moveCompositeAcrossEditors(params);
        return;
    }

    moveSingleRangeAcrossEditors(params);
}

function moveSingleRangeAcrossEditors(params: CrossEditorMoveParams): void {
    const {
        sourceView,
        targetView,
        sourceBlock,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
        deps,
    } = params;
    const sourceDoc = sourceView.state.doc as unknown as DocLikeWithRange;
    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    const targetLineNumber = resolveTargetLineNumber(params);
    const lineMap = getLineMap(targetView.state);
    const containerRule = deps.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber, { lineMap });
    if (!containerRule.decision.allowDrop) {
        return;
    }

    const sourceStartLineNumber = clampLineNumber(sourceDoc.lines, sourceBlock.startLine + 1);
    const sourceEndLineNumber = Math.max(sourceStartLineNumber, clampLineNumber(sourceDoc.lines, sourceBlock.endLine + 1));
    const sourceStartLine = sourceDoc.line(sourceStartLineNumber);
    const sourceEndLine = sourceDoc.line(sourceEndLineNumber);
    const sourceFrom = sourceStartLine.from;
    const sourceTo = sourceEndLine.to;
    const sourceContent = sourceDoc.sliceString(sourceFrom, sourceTo);
    const insertText = deps.buildInsertText(
        targetDoc,
        sourceBlock,
        targetLineNumber,
        sourceContent,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride
    );
    const insertion = resolveInsertionChange(targetDoc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: targetDoc.length,
    });

    targetView.dispatch({
        changes: { from: insertion.pos, to: insertion.pos, insert: insertion.text },
        scrollIntoView: false,
    });

    const deleteRange = resolveDeleteRange(sourceDoc, sourceFrom, sourceTo);
    sourceView.dispatch({
        changes: { from: deleteRange.from, to: deleteRange.to },
        scrollIntoView: false,
    });

    scheduleRenumber({
        sourceView,
        targetView,
        sourceLineNumbers: [sourceStartLineNumber],
        targetLineNumbers: [targetLineNumber],
        parseLineWithQuote: deps.parseLineWithQuote,
    });
}

function moveCompositeAcrossEditors(params: CrossEditorMoveParams): void {
    const {
        sourceView,
        targetView,
        sourceBlock,
        deps,
    } = params;
    const sourceDoc = sourceView.state.doc as unknown as DocLikeWithRange;
    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    const normalizedRanges = normalizeCompositeRanges(sourceBlock.compositeSelection?.ranges ?? [], sourceDoc.lines);
    if (normalizedRanges.length <= 1) {
        moveSingleRangeAcrossEditors(params);
        return;
    }

    const targetLineNumber = resolveTargetLineNumber(params);
    const lineMap = getLineMap(targetView.state);
    const containerRule = deps.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber, { lineMap });
    if (!containerRule.decision.allowDrop) {
        return;
    }

    const segments = normalizedRanges.map((range) => {
        const startLineNumber = range.startLine + 1;
        const endLineNumber = range.endLine + 1;
        const startLine = sourceDoc.line(startLineNumber);
        const endLine = sourceDoc.line(endLineNumber);
        const sourceFrom = startLine.from;
        const sourceTo = endLine.to;
        const deleteRange = resolveDeleteRange(sourceDoc, sourceFrom, sourceTo);
        return {
            sourceFrom,
            sourceTo,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
            startLineNumber,
        };
    });

    const insertText = segments
        .map((segment) => sourceDoc.sliceString(segment.sourceFrom, Math.min(segment.sourceTo + 1, sourceDoc.length)))
        .join('');
    if (!insertText.length) {
        return;
    }

    const insertion = resolveInsertionChange(targetDoc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: targetDoc.length,
    });
    targetView.dispatch({
        changes: { from: insertion.pos, to: insertion.pos, insert: insertion.text },
        scrollIntoView: false,
    });

    sourceView.dispatch({
        changes: segments
            .map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo }))
            .sort((a, b) => b.from - a.from),
        scrollIntoView: false,
    });

    const sourceLineNumbers = segments.map((segment) => segment.startLineNumber);
    scheduleRenumber({
        sourceView,
        targetView,
        sourceLineNumbers,
        targetLineNumbers: [targetLineNumber],
        parseLineWithQuote: deps.parseLineWithQuote,
    });
}

function resolveTargetLineNumber(params: CrossEditorMoveParams): number {
    const {
        targetView,
        targetPos,
        targetLineNumberOverride,
        deps,
    } = params;
    const targetLine = targetView.state.doc.lineAt(targetPos);
    let targetLineNumber = targetLineNumberOverride ?? targetLine.number;

    if (targetLineNumberOverride === undefined) {
        const adjusted = deps.getAdjustedTargetLocation(targetLine.number);
        if (adjusted.blockAdjusted) {
            targetLineNumber = adjusted.lineNumber;
        }
    }

    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    return clampTargetLineNumber(targetDoc.lines, targetLineNumber);
}

function scheduleRenumber(params: {
    sourceView: EditorView;
    targetView: EditorView;
    sourceLineNumbers: number[];
    targetLineNumbers: number[];
    parseLineWithQuote: (line: string) => ParsedLine;
}): void {
    const {
        sourceView,
        targetView,
        sourceLineNumbers,
        targetLineNumbers,
        parseLineWithQuote,
    } = params;
    const sourceRenumberer = new ListRenumberer({ view: sourceView, parseLineWithQuote });
    const targetRenumberer = new ListRenumberer({ view: targetView, parseLineWithQuote });
    const sourceTargets = new Set<number>(sourceLineNumbers);
    const targetTargets = new Set<number>(targetLineNumbers);

    setTimeout(() => {
        for (const lineNumber of sourceTargets) {
            sourceRenumberer.renumberOrderedListAround(lineNumber);
        }
        for (const lineNumber of targetTargets) {
            targetRenumberer.renumberOrderedListAround(lineNumber);
        }
    }, 0);
}

function normalizeCompositeRanges(
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

function resolveInsertionChange(
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

function resolveDeleteRange(
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

function clampLineNumber(totalLines: number, lineNumber: number): number {
    return Math.max(1, Math.min(totalLines, lineNumber));
}


