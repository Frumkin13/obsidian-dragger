import { EditorView } from '@codemirror/view';
import { getPreviousNonEmptyLineNumber } from '../domain/rules/container-policy';
import { DropPlannerDeps, DropValidationResult } from '../drag/drop/drop-planner';
import { DragDropServiceContainer } from './drag-service-container';
import { BlockInfo } from '../domain/block/block-types';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { ListDropPlanner } from '../drag/drop/list-drop-planner';

export function createDropPlannerDeps(params: {
    view: EditorView;
    services: DragDropServiceContainer;
    dragPerfManager: DragPerfSessionManager;
    onDragTargetEvaluated: (info: {
        sourceBlock: BlockInfo | null;
        pointerType: string | null;
        validation: DropValidationResult;
    }) => void;
}): DropPlannerDeps {
    const sharedDeps = params.services.createDropPlannerDeps({
        recordPerfDuration: (key, durationMs) => {
            params.dragPerfManager.recordDuration(key, durationMs);
        },
        incrementPerfCounter: (key, delta = 1) => {
            params.dragPerfManager.incrementCounter(key, delta);
        },
        onDragTargetEvaluated: params.onDragTargetEvaluated,
    });
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


