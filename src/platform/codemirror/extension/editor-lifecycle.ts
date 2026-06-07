import { EditorView } from '@codemirror/view';
import { prewarmFenceScan } from '../../../domain/markdown/fence-scanner';
import { PointerDragController } from '../input/pointer-drag-controller';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';
import {
    GlobalPointerMoveClient,
    registerGlobalPointerMoveClient,
    unregisterGlobalPointerMoveClient,
} from './global-pointermove-router';

export interface ViewLifecycleStartDeps {
    view: EditorView;
    pointerDragController: PointerDragController;
    pointerMoveClient: GlobalPointerMoveClient;
    onSettingsUpdated: () => void;
}

export interface ViewLifecycleDestroyDeps {
    semanticRefreshScheduler: SemanticRefreshScheduler;
    pointerMoveClient: GlobalPointerMoveClient;
    onSettingsUpdated: () => void;
    pointerDragController: PointerDragController;
}

export function startViewLifecycle(deps: ViewLifecycleStartDeps): void {
    deps.pointerDragController.attach();
    registerGlobalPointerMoveClient(deps.pointerMoveClient);
    window.addEventListener('dnd:settings-updated', deps.onSettingsUpdated);
    scheduleFenceScanWarmup(deps.view);
}

export function destroyViewLifecycle(deps: ViewLifecycleDestroyDeps): void {
    deps.semanticRefreshScheduler.destroy();
    unregisterGlobalPointerMoveClient(deps.pointerMoveClient);
    window.removeEventListener('dnd:settings-updated', deps.onSettingsUpdated);
    deps.pointerDragController.destroy();
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
