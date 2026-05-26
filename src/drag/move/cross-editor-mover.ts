import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import { InsertionSlotContext } from '../../domain/rules/insertion-rules';
import { getLineMap, LineMap } from '../../domain/markdown/line-map';
import { DocLike, DocLikeWithRange, DropPlan, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { captureSourcePayload } from './source-payload';
import { resolveInsertionChange } from './document-change';
import { ListRenumberer } from './list-renumberer';
import { BlockFoldStateManager, CapturedBlockFoldState } from './block-fold-state';

export interface CrossEditorMoveDeps {
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
        listIntent?: DropPlan['listIntent']
    ) => string;
    blockFoldState?: Pick<BlockFoldStateManager, 'restore'>;
}

export type CrossEditorMoveParams = {
    sourceView: EditorView;
    targetView: EditorView;
    sourceBlock: BlockInfo;
    dropPlan: DropPlan;
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
        dropPlan,
        capturedBlockFoldState,
        deps,
    } = params;
    const sourceDoc = sourceView.state.doc as unknown as DocLikeWithRange;
    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    const targetLineNumber = clampTargetLineNumber(targetDoc.lines, dropPlan.targetLineNumber);
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
        dropPlan.listIntent
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
        dropPlan,
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
        sourceBlock.content,
        dropPlan.listIntent
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
