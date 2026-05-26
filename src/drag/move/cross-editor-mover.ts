import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import { InsertionSlotContext } from '../../domain/rules/insertion-rules';
import { getLineMap, LineMap } from '../../domain/markdown/line-map';
import { DocLike, DocLikeWithRange, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { captureSourcePayload } from './source-payload';
import { resolveInsertionChange } from './document-change';
import { ListRenumberer } from './list-renumberer';
import { BlockFoldStateManager, CapturedBlockFoldState } from './block-fold-state';

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
    blockFoldState?: Pick<BlockFoldStateManager, 'restore'>;
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
    capturedBlockFoldState?: CapturedBlockFoldState | null;
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
        capturedBlockFoldState,
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

    const payload = captureSourcePayload(sourceDoc, sourceBlock);
    if (!payload) return;
    const segment = payload.segments[0];
    const insertText = deps.buildInsertText(
        targetDoc,
        sourceBlock,
        targetLineNumber,
        payload.content,
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

    sourceView.dispatch({
        changes: { from: segment.deleteFrom, to: segment.deleteTo },
        scrollIntoView: false,
    });

    finalizeMove({
        sourceView,
        targetView,
        sourceLineNumbers: [segment.startLineNumber],
        targetLineNumbers: [targetLineNumber],
        parseLineWithQuote: deps.parseLineWithQuote,
        restoreTargetBlockFoldState: () => deps.blockFoldState?.restore(targetView, targetLineNumber, capturedBlockFoldState ?? null),
    });
}

function moveCompositeAcrossEditors(params: CrossEditorMoveParams): void {
    const {
        sourceView,
        targetView,
        sourceBlock,
        capturedBlockFoldState,
        deps,
    } = params;
    const sourceDoc = sourceView.state.doc as unknown as DocLikeWithRange;
    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    const payload = captureSourcePayload(sourceDoc, sourceBlock);
    if (!payload || payload.segments.length <= 1) {
        moveSingleRangeAcrossEditors(params);
        return;
    }

    const targetLineNumber = resolveTargetLineNumber(params);
    const lineMap = getLineMap(targetView.state);
    const containerRule = deps.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber, { lineMap });
    if (!containerRule.decision.allowDrop) {
        return;
    }

    const insertText = deps.buildInsertText(
        targetDoc,
        sourceBlock,
        targetLineNumber,
        sourceBlock.content,
        params.listContextLineNumberOverride,
        params.listIndentDeltaOverride,
        params.listTargetIndentWidthOverride
    );
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
        changes: payload.segments
            .map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo }))
            .sort((a, b) => b.from - a.from),
        scrollIntoView: false,
    });

    const sourceLineNumbers = payload.segments.map((segment) => segment.startLineNumber);
    finalizeMove({
        sourceView,
        targetView,
        sourceLineNumbers,
        targetLineNumbers: [targetLineNumber],
        parseLineWithQuote: deps.parseLineWithQuote,
        restoreTargetBlockFoldState: () => deps.blockFoldState?.restore(targetView, targetLineNumber, capturedBlockFoldState ?? null),
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
