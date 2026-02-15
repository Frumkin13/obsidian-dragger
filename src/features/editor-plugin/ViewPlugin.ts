import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../../main';
import {
    ROOT_EDITOR_CLASS,
    MAIN_EDITOR_CONTENT_CLASS,
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from '../../shared/dom-selectors';
import { getActiveDragSourceBlock } from '../../core/services/state/drag-session';
import { isPosInsideRenderedTableCell } from '../../infra/dom/probe/table-guard';
import { prewarmFenceScan } from '../../core/model/block/block-factory';
import { BlockMover } from '../drag-operation/strategies/standard-move';
import { DropIndicatorManager } from '../../infra/dom/indicator/line-indicator';
import { DropTargetCalculator } from '../../core/services/geometry/collision-detector';
import { DragEventHandler } from '../drag-operation/interactions/MouseHandler';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
} from '../../infra/dom/indicator/ghost-element';
import { LineHandleManager } from '../drag-handle/view/DragHandleView';
import { HandleVisibilityController } from '../drag-handle/controller/VisibilityController';
import { resolveHoverHandle } from '../drag-handle/controller/HoverLogic';
import { SemanticRefreshScheduler } from './Decorations';
import { LineMapPrewarmer } from './line-map-prewarmer';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { ServiceContainer } from '../../core/services/service-container';
import { hasVisibleLineNumberGutter } from '../../infra/dom/handle/handle-positioner';
import { DragLifecycleEmitter } from '../../core/services/state/drag-lifecycle-emitter';
import { HandleInteractionOrchestrator } from '../drag-operation/orchestrator';
import { DragLifecycleEvent } from '../../shared/types/drag-events';
import { normalizeDragSourceVisualStyle } from '../../settings';

export function createDragHandleViewPluginClass(plugin: DragNDropPlugin) {
    return class {
        // decorations removed - now using LineHandleManager with independent DOM elements
        private readonly view: EditorView;
        private readonly services: ServiceContainer;
        private readonly dropIndicator: DropIndicatorManager;
        private readonly blockMover: BlockMover;
        private readonly dropTargetCalculator: DropTargetCalculator;
        private readonly lineHandleManager: LineHandleManager;
        private readonly dragEventHandler: DragEventHandler;
        private readonly handleVisibility: HandleVisibilityController;
        private readonly orchestrator: HandleInteractionOrchestrator;
        private readonly lifecycleEmitter = new DragLifecycleEmitter(
            (event) => plugin.emitDragLifecycleEvent(event)
        );
        private readonly lineMapPrewarmer = new LineMapPrewarmer();
        private readonly dragPerfManager: DragPerfSessionManager;
        private readonly semanticRefreshScheduler: SemanticRefreshScheduler;
        private lastPointerPos: { x: number; y: number } | null = null;
        private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
        private readonly onSettingsUpdated = () => this.handleSettingsUpdated();

        constructor(view: EditorView) {
            this.view = view;
            this.ensureEditorRootClasses();
            this.syncDragSourceVisualStyleAttr();
            this.syncDragSourceHighlightEnabledAttr();
            this.syncGutterClass();
            this.services = new ServiceContainer(this.view);
            this.handleVisibility = new HandleVisibilityController(this.view, {
                getBlockInfoForHandle: (handle) => this.services.dragSource.getBlockInfoForHandle(handle),
                getDraggableBlockAtPoint: (clientX, clientY) => this.services.dragSource.getDraggableBlockAtPoint(clientX, clientY),
            });
            this.dragPerfManager = new DragPerfSessionManager(this.view);
            this.dropTargetCalculator = new DropTargetCalculator(this.view,
                this.services.createDropTargetCalculatorDeps({
                    recordPerfDuration: (key, durationMs) => {
                        this.dragPerfManager.recordDuration(key, durationMs);
                    },
                    incrementPerfCounter: (key, delta = 1) => {
                        this.dragPerfManager.incrementCounter(key, delta);
                    },
                    onDragTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                        if (!sourceBlock) return;
                        this.orchestrator.emitDragLifecycle({
                            state: 'drag_active',
                            sourceBlock,
                            targetLine: validation.targetLineNumber ?? null,
                            listIntent: this.orchestrator.buildListIntentFromValidation(validation),
                            rejectReason: validation.allowed ? null : (validation.reason ?? null),
                            pointerType: pointerType ?? null,
                        });
                    },
                }),
            );
            this.dropIndicator = new DropIndicatorManager(view, (info) =>
                this.dropTargetCalculator.getDropTargetInfo({
                    clientX: info.clientX,
                    clientY: info.clientY,
                    dragSource: info.dragSource ?? getActiveDragSourceBlock(this.view) ?? null,
                    pointerType: info.pointerType ?? null,
                })
                , {
                    isDropHighlightEnabled: () => plugin.settings.enableListDropHighlight !== false,
                    recordPerfDuration: (key, durationMs) => {
                        this.dragPerfManager.recordDuration(key, durationMs);
                    },
                    onFrameMetrics: (metrics) => {
                        this.dragPerfManager.incrementCounter('drop_indicator_frames');
                        if (metrics.skipped) {
                            this.dragPerfManager.incrementCounter('drop_indicator_skipped_frames');
                        }
                        if (metrics.reused) {
                            this.dragPerfManager.incrementCounter('drop_indicator_reused_frames');
                        }
                    },
                }
            );
            this.blockMover = new BlockMover({
                view: this.view,
                ...this.services.createBlockMoverDeps(),
            });
            this.orchestrator = new HandleInteractionOrchestrator({
                view: this.view,
                services: this.services,
                blockMover: this.blockMover,
                dropTargetCalculator: this.dropTargetCalculator,
                handleVisibility: this.handleVisibility,
                dragPerfManager: this.dragPerfManager,
                lifecycleEmitter: this.lifecycleEmitter,
                getSemanticRefreshScheduler: () => this.semanticRefreshScheduler,
                refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
                getDragEventHandler: () => this.dragEventHandler,
            });
            this.lineHandleManager = new LineHandleManager(this.view, {
                createHandleElement: (getBlockInfo) => this.orchestrator.createHandleElement(getBlockInfo),
                getDraggableBlockAtLine: (lineNumber) => this.services.dragSource.getDraggableBlockAtLine(lineNumber),
                shouldRenderLineHandles: () => true,
            });
            this.dragEventHandler = new DragEventHandler(this.view, {
                getDragSourceBlock: (e) => getDragSourceBlockFromEvent(e, this.view),
                getBlockInfoForHandle: (handle) =>
                    this.orchestrator.resolveInteractionBlockInfo({
                        handle,
                        clientX: Number.NaN,
                        clientY: Number.NaN,
                    }),
                getBlockInfoAtPoint: (clientX, clientY) =>
                    this.orchestrator.resolveInteractionBlockInfo({
                        clientX,
                        clientY,
                    }),
                isBlockInsideRenderedTableCell: (blockInfo) =>
                    isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                isMultiLineSelectionEnabled: () => plugin.settings.enableMultiLineSelection,
                isMobileTextLongPressDragEnabled: () => plugin.settings.enableMobileTextLongPressDrag,
                beginPointerDragSession: (blockInfo) => {
                    this.orchestrator.ensureDragPerfSession();
                    if (this.isDragSourceHighlightEnabled()) {
                        this.handleVisibility.enterGrabVisualStateForBlock(blockInfo, null);
                    }
                    beginDragSession(blockInfo, this.view);
                },
                finishDragSession: () => {
                    this.handleVisibility.clearGrabbedLineNumbers();
                    this.handleVisibility.setActiveVisibleHandle(null);
                    finishDragSession(this.view);
                    this.orchestrator.flushDragPerfSession('finish_drag_session');
                    this.refreshDecorationsAndEmbeds();
                },
                scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                    this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource, pointerType ?? null),
                hideDropIndicator: () => this.dropIndicator.hide(),
                performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                    this.orchestrator.performDropAtPoint(sourceBlock, clientX, clientY, pointerType ?? null),
                onDragLifecycleEvent: (event) => {
                    this.handleSourceVisualByLifecycle(event);
                    this.orchestrator.emitDragLifecycle(event);
                },
            });

            this.semanticRefreshScheduler = new SemanticRefreshScheduler(this.view, {
                performRefresh: () => this.refreshDecorationsAndEmbeds(),
                isGestureActive: () => this.dragEventHandler.isGestureActive(),
                refreshSelectionVisual: () => this.dragEventHandler.refreshSelectionVisual(),
            });

            this.lineHandleManager.start();
            this.dragEventHandler.attach();
            this.semanticRefreshScheduler.bindViewportScrollFallback();
            document.addEventListener('pointermove', this.onDocumentPointerMove, { passive: true });
            window.addEventListener('dnd:settings-updated', this.onSettingsUpdated);

            // Pre-warm fence scan during idle to ensure code/math block boundaries are ready
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

        update(update: ViewUpdate) {
            this.ensureEditorRootClasses();
            this.syncDragSourceVisualStyleAttr();
            this.syncDragSourceHighlightEnabledAttr();
            // Viewport changes have highest priority - refresh visible decorations immediately
            if (update.viewportChanged) {
                this.refreshDecorationsAndEmbeds();
                this.dragEventHandler.refreshSelectionVisual();
                this.handleVisibility.refreshGrabVisualState();
                // Deferred rescan to catch layout shifts after viewport/file switch
                this.lineHandleManager.scheduleScan();
                // Still schedule line-map prewarm if doc changed
                if (update.docChanged) {
                    this.lineMapPrewarmer.schedule(update);
                }
                const activeHandle = this.handleVisibility.getActiveHandle();
                if (activeHandle && !activeHandle.isConnected) {
                    this.handleVisibility.setActiveVisibleHandle(null);
                    this.reResolveActiveHandle();
                }
                return;
            }

            if (update.docChanged) {
                // Mark semantic refresh pending - LineHandleManager will update on refresh
                this.semanticRefreshScheduler.markSemanticRefreshPending();
                this.lineMapPrewarmer.schedule(update);
            } else if (update.geometryChanged) {
                this.refreshDecorationsAndEmbeds();
            }

            if (update.docChanged || update.geometryChanged) {
                this.dragEventHandler.refreshSelectionVisual();
                this.handleVisibility.refreshGrabVisualState();
            }
            const activeHandle2 = this.handleVisibility.getActiveHandle();
            if (activeHandle2 && !activeHandle2.isConnected) {
                this.handleVisibility.setActiveVisibleHandle(null);
                this.reResolveActiveHandle();
            }
        }

        destroy(): void {
            this.lineMapPrewarmer.clear();
            this.semanticRefreshScheduler.destroy();
            document.removeEventListener('pointermove', this.onDocumentPointerMove);
            window.removeEventListener('dnd:settings-updated', this.onSettingsUpdated);
            this.handleVisibility.clearGrabbedLineNumbers();
            this.handleVisibility.setActiveVisibleHandle(null);
            finishDragSession(this.view);
            this.orchestrator.flushDragPerfSession('destroy');
            this.dragEventHandler.destroy();
            this.lineHandleManager.destroy();
            this.view.dom.classList.remove(ROOT_EDITOR_CLASS);
            this.view.dom.removeAttribute('data-dnd-drag-source-style');
            this.view.dom.removeAttribute('data-dnd-drag-source-highlight');
            this.view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
            this.dropIndicator.destroy();
            this.orchestrator.emitDragLifecycle({
                state: 'idle',
                sourceBlock: null,
                targetLine: null,
                listIntent: null,
                rejectReason: null,
                pointerType: null,
            });
        }

        private handleDocumentPointerMove(e: PointerEvent): void {
            this.lastPointerPos = { x: e.clientX, y: e.clientY };
            if (document.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) {
                return;
            }
            if (document.body.classList.contains(DRAGGING_BODY_CLASS)) {
                this.handleVisibility.setActiveVisibleHandle(null, { preserveHoveredLineNumber: true });
                return;
            }
            if (this.dragEventHandler.isGestureActive()) {
                this.handleVisibility.setActiveVisibleHandle(this.handleVisibility.getActiveHandle(), { preserveHoveredLineNumber: true });
                return;
            }
            if (this.semanticRefreshScheduler.isPending && this.handleVisibility.isPointerInHandleInteractionZone(e.clientX, e.clientY)) {
                this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
            }

            const directHandle = this.handleVisibility.resolveVisibleHandleFromTarget(e.target);
            if (directHandle) {
                this.handleVisibility.setActiveVisibleHandle(directHandle);
                return;
            }

            // When line numbers are visible, keep the original behavior:
            // only show the hovered handle itself.
            if (hasVisibleLineNumberGutter(this.view)) {
                this.handleVisibility.setActiveVisibleHandle(null);
                return;
            }

            // Without line numbers, hovering anywhere on the current line's right area
            // should reveal the left handle for that line.
            const handle = resolveHoverHandle(this.view, this.handleVisibility, e.clientX, e.clientY);
            this.handleVisibility.setActiveVisibleHandle(handle);
        }

        private reResolveActiveHandle(): void {
            if (!this.lastPointerPos) return;
            const { x, y } = this.lastPointerPos;
            if (hasVisibleLineNumberGutter(this.view)) {
                if (!this.handleVisibility.isPointerInHandleInteractionZone(x, y)) return;
            }
            const handle = resolveHoverHandle(this.view, this.handleVisibility, x, y);
            if (handle) {
                this.handleVisibility.setActiveVisibleHandle(handle);
            }
        }

        private syncGutterClass(): void {
            const hasGutter = hasVisibleLineNumberGutter(this.view);
            this.view.dom.classList.toggle('dnd-no-gutter', !hasGutter);
        }

        private ensureEditorRootClasses(): void {
            this.view.dom.classList.add(ROOT_EDITOR_CLASS);
            this.view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
        }

        private syncDragSourceVisualStyleAttr(): void {
            const style = normalizeDragSourceVisualStyle(plugin.settings.dragSourceVisualStyle);
            this.view.dom.setAttribute('data-dnd-drag-source-style', style);
        }

        private syncDragSourceHighlightEnabledAttr(): void {
            this.view.dom.setAttribute(
                'data-dnd-drag-source-highlight',
                this.isDragSourceHighlightEnabled() ? 'on' : 'off',
            );
        }

        private isDragSourceHighlightEnabled(): boolean {
            return plugin.settings.enableDragSourceHighlight !== false;
        }

        private refreshDecorationsAndEmbeds(): void {
            this.ensureEditorRootClasses();
            this.syncGutterClass();
            this.semanticRefreshScheduler.clearPendingSemanticRefresh();
            this.lineHandleManager.scheduleScan();
        }

        private handleSettingsUpdated(): void {
            this.ensureEditorRootClasses();
            this.syncDragSourceVisualStyleAttr();
            this.syncDragSourceHighlightEnabledAttr();
            this.refreshDecorationsAndEmbeds();
            this.dragEventHandler.refreshSelectionVisual();
            this.handleVisibility.refreshGrabVisualState();
        }

        private handleSourceVisualByLifecycle(event: DragLifecycleEvent): void {
            if (event.state === 'press_pending') {
                if (event.pressReady && event.sourceBlock && this.isDragSourceHighlightEnabled()) {
                    this.handleVisibility.enterGrabVisualStateForBlock(event.sourceBlock, null);
                } else {
                    // Pressing should not show drag-source highlight before long-press is ready.
                    this.handleVisibility.clearGrabbedLineNumbers();
                }
                return;
            }
            if (event.state === 'drag_active') {
                if (event.sourceBlock && this.isDragSourceHighlightEnabled()) {
                    this.handleVisibility.enterGrabVisualStateForBlock(event.sourceBlock, null);
                } else if (!this.isDragSourceHighlightEnabled()) {
                    this.handleVisibility.clearGrabbedLineNumbers();
                }
                return;
            }
            if (event.state === 'cancelled' || event.state === 'idle') {
                // Desktop native drag can coexist with pointer-range session cancellation.
                // While a drag session is active, keep source visual instead of clearing.
                const hasActiveNativeDrag = document.body.classList.contains(DRAGGING_BODY_CLASS)
                    || !!getActiveDragSourceBlock(this.view);
                if (hasActiveNativeDrag) return;
                this.handleVisibility.clearGrabbedLineNumbers();
                return;
            }
            if (event.state === 'drop_commit') {
                this.handleVisibility.clearGrabbedLineNumbers();
            }
        }
    };
}
