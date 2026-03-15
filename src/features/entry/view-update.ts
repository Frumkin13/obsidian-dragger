import { ViewUpdate } from '@codemirror/view';
import { DragEventHandler } from '../interaction/drag-event-handler';
import { HandleVisibilityController } from '../ui/handle/handle-visibility-controller';
import { LineHandleManager } from '../ui/handle/line-handle-manager';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';

export interface ViewUpdateFlowDeps {
    refreshDecorationsAndEmbeds: () => void;
    dragEventHandler: DragEventHandler;
    handleVisibility: HandleVisibilityController;
    lineHandleManager: LineHandleManager;
    semanticRefreshScheduler: SemanticRefreshScheduler;
    reResolveActiveHandle: () => void;
}

export function applyViewUpdate(update: ViewUpdate, deps: ViewUpdateFlowDeps): void {
    if (update.viewportChanged) {
        deps.refreshDecorationsAndEmbeds();
        deps.dragEventHandler.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
        deps.lineHandleManager.scheduleScan();
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
        deps.dragEventHandler.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
    }
    const activeHandle = deps.handleVisibility.getActiveHandle();
    if (activeHandle && !activeHandle.isConnected) {
        deps.handleVisibility.setActiveVisibleHandle(null);
        deps.reResolveActiveHandle();
    }
}

