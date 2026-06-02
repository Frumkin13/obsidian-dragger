import { EditorView } from '@codemirror/view';
import { getPreviousNonEmptyLineNumber } from '../domain/rules/container-policy';
import { DropPlannerDeps, DropPlannerSharedDeps } from '../drag/drop/drop-planner';
import { EditorContext } from './drag-service-container';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { ListDropPlanner } from '../drag/drop/list-drop-planner';

export function createDropPlannerDeps(params: {
    view: EditorView;
    context: EditorContext;
    dragPerfManager: DragPerfSessionManager;
}): DropPlannerDeps {
    const sharedDeps: DropPlannerSharedDeps = {
        ...params.context,
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


