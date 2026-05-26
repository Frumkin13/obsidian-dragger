import { EditorView } from '@codemirror/view';
import { getPreviousNonEmptyLineNumber } from '../domain/rules/container-policy';
import { DropTargetCalculatorDeps, DropValidationResult } from '../drag/drop/drop-planner';
import { DragDropServiceContainer } from './drag-service-container';
import { BlockInfo } from '../domain/block/block-types';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { ListDropTargetCalculator } from '../drag/drop/list-drop-planner';

export function createDropTargetCalculatorDeps(params: {
    view: EditorView;
    services: DragDropServiceContainer;
    dragPerfManager: DragPerfSessionManager;
    onDragTargetEvaluated: (info: {
        sourceBlock: BlockInfo | null;
        pointerType: string | null;
        validation: DropValidationResult;
    }) => void;
}): DropTargetCalculatorDeps {
    const sharedDeps = params.services.createDropTargetCalculatorDeps({
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
        listDropTargetCalculator: new ListDropTargetCalculator(params.view, {
            parseLineWithQuote: sharedDeps.parseLineWithQuote,
            getPreviousNonEmptyLineNumber,
            getIndentUnitWidthForDoc: sharedDeps.getIndentUnitWidthForDoc,
            getBlockRect: sharedDeps.getBlockRect,
            incrementPerfCounter: sharedDeps.incrementPerfCounter,
        }),
    };
}


