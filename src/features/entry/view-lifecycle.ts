import { EditorView } from '@codemirror/view';
import { prewarmFenceScan } from '../../core/parser/fence-scanner';
import { DragEventHandler } from '../interaction/drag-event-handler';
import { LineHandleManager } from '../ui/handle/line-handle-manager';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';

export interface ViewLifecycleStartDeps {
    view: EditorView;
    lineHandleManager: LineHandleManager;
    dragEventHandler: DragEventHandler;
    semanticRefreshScheduler: SemanticRefreshScheduler;
    onDocumentPointerMove: (event: PointerEvent) => void;
    onSettingsUpdated: () => void;
}

export interface ViewLifecycleDestroyDeps {
    semanticRefreshScheduler: SemanticRefreshScheduler;
    onDocumentPointerMove: (event: PointerEvent) => void;
    onSettingsUpdated: () => void;
    dragEventHandler: DragEventHandler;
    lineHandleManager: LineHandleManager;
}

export function startViewLifecycle(deps: ViewLifecycleStartDeps): void {
    deps.lineHandleManager.start();
    deps.dragEventHandler.attach();
    deps.semanticRefreshScheduler.bindViewportScrollFallback();
    document.addEventListener('pointermove', deps.onDocumentPointerMove, { passive: true });
    window.addEventListener('dnd:settings-updated', deps.onSettingsUpdated);
    scheduleFenceScanWarmup(deps.view);
}

export function destroyViewLifecycle(deps: ViewLifecycleDestroyDeps): void {
    deps.semanticRefreshScheduler.destroy();
    document.removeEventListener('pointermove', deps.onDocumentPointerMove);
    window.removeEventListener('dnd:settings-updated', deps.onSettingsUpdated);
    deps.dragEventHandler.destroy();
    deps.lineHandleManager.destroy();
}

function scheduleFenceScanWarmup(view: EditorView): void {
    const warmupFenceScan = () => prewarmFenceScan(view.state.doc);
    const requestIdle = window.requestIdleCallback as
        | ((cb: () => void, options?: { timeout?: number }) => number)
        | undefined;
    if (typeof requestIdle === 'function') {
        requestIdle(warmupFenceScan, { timeout: 1000 });
    } else {
        window.setTimeout(warmupFenceScan, 100);
    }
}

