import { ViewUpdate } from '@codemirror/view';
import { PointerDragController } from '../input/pointer-drag-controller';
import { HandleVisibilityController } from '../preview/handle-visibility-controller';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';

export interface ViewUpdateFlowDeps {
    refreshDecorationsAndEmbeds: () => void;
    pointerDragController: PointerDragController;
    handleVisibility: HandleVisibilityController;
    semanticRefreshScheduler: SemanticRefreshScheduler;
    reResolveActiveHandle: () => void;
}

export function applyViewUpdate(update: ViewUpdate, deps: ViewUpdateFlowDeps): void {
    if (update.viewportChanged) {
        deps.refreshDecorationsAndEmbeds();
        deps.pointerDragController.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
        const activeHandle = deps.handleVisibility.getActiveHandle();
        if (activeHandle && !activeHandle.isConnected) {
            deps.handleVisibility.setActiveVisibleHandle(null);
            deps.reResolveActiveHandle();
        }
        return;
    }

    if (update.docChanged) {
        deps.semanticRefreshScheduler.markSemanticRefreshPending();
    } else if (update.geometryChanged) {
        deps.refreshDecorationsAndEmbeds();
    }

    if (update.docChanged || update.geometryChanged) {
        deps.pointerDragController.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
    }
    const activeHandle = deps.handleVisibility.getActiveHandle();
    if (activeHandle && !activeHandle.isConnected) {
        deps.handleVisibility.setActiveVisibleHandle(null);
        deps.reResolveActiveHandle();
    }
}

