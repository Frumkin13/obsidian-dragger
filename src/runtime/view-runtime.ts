import { EditorView } from '@codemirror/view';
import { getPreviousNonEmptyLineNumber } from '../domain/rules/container-policy';
import { DropPlannerDeps, DropPlannerSharedDeps, ListDropPlanner } from '../drag/drop';
import { BlockFoldStateManager, BlockMoverDeps } from '../drag/move';
import { EditorContext } from './drag-service-container';
import { DragPerfSessionManager } from './drag-perf-session-manager';

export function createDropPlannerDeps(params: {
    view: EditorView;
    context: EditorContext;
    dragPerfManager: DragPerfSessionManager;
}): DropPlannerDeps {
    const sharedDeps: DropPlannerSharedDeps = {
        parseLineWithQuote: params.context.parseLineWithQuote,
        getAdjustedTargetLocation: params.context.getAdjustedTargetLocation,
        resolveDropRuleAtInsertion: params.context.resolveDropRuleAtInsertion,
        getListContext: params.context.getListContext,
        getIndentUnitWidth: params.context.getIndentUnitWidth,
        getBlockInfoForEmbed: params.context.getBlockInfoForEmbed,
        getIndentUnitWidthForDoc: params.context.getIndentUnitWidthForDoc,
        getLineRect: params.context.getLineRect,
        getInsertionAnchorY: params.context.getInsertionAnchorY,
        getLineIndentPosByWidth: params.context.getLineIndentPosByWidth,
        getBlockRect: params.context.getBlockRect,
        recordPerfDuration: (key, durationMs) => {
            params.dragPerfManager.recordDuration(key, durationMs);
        },
        incrementPerfCounter: (key, delta = 1) => {
            params.dragPerfManager.incrementCounter(key, delta);
        },
    };
    return {
        ...sharedDeps,
        listDropPlanner: new ListDropPlanner(params.view, {
            parseLineWithQuote: sharedDeps.parseLineWithQuote,
            getPreviousNonEmptyLineNumber,
            getIndentUnitWidthForDoc: sharedDeps.getIndentUnitWidthForDoc,
            getBlockRect: sharedDeps.getBlockRect,
            incrementPerfCounter: sharedDeps.incrementPerfCounter,
        }),
    };
}

export function createBlockMoverDeps(params: {
    context: EditorContext;
    blockFoldState: BlockFoldStateManager;
}): BlockMoverDeps {
    return {
        view: params.context.view,
        resolveDropRuleAtInsertion: params.context.resolveDropRuleAtInsertion,
        parseLineWithQuote: params.context.parseLineWithQuote,
        getListContext: params.context.getListContext,
        getIndentUnitWidth: params.context.getIndentUnitWidth,
        buildInsertText: params.context.buildInsertText,
        blockFoldState: params.blockFoldState,
    };
}


