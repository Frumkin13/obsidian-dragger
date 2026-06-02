import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../plugin/main';
import {
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from '../shared/dom-selectors';
import {
    beginDragSession,
    finishDragSession,
    getActiveDragSourceBlock,
    getActiveDragSourceView,
} from '../drag/gesture/drag-session';
import { isPosInsideRenderedTableCell } from '../platform/dom/table-guard';
import { BlockMover } from '../drag/move/block-mover';
import { DropIndicatorManager } from '../drag/drop/drop-indicator';
import { DropPlanner } from '../drag/drop/drop-planner';
import { DragEventHandler } from '../drag/gesture/drag-controller';
import { getVisibleHandleForBlockStart } from '../drag/source/handle-renderer';
import { HandleVisibilityController } from '../drag/source/handle-visibility-controller';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { createEditorContext, EditorContext } from './drag-service-container';
import { DragLifecycleEmitter } from './drag-lifecycle-emitter';
import { buildListIntent } from '../shared/utils/drop-protocol';
import { buildDragTargetChangedLifecycleEvent, buildIdleLifecycleEvent } from '../drag/gesture/drag-lifecycle-flow';
import { DragInteractionOrchestrator } from '../drag/gesture/interaction-orchestrator';
import { DragLifecycleEvent, DragSourceScope } from '../shared/types/drag';
import { DND_DRAG_SOURCE_HIGHLIGHT_ATTR, DND_DRAG_SOURCE_STYLE_ATTR } from '../shared/dom-attrs';
import { normalizeDragSourceVisualStyle } from '../plugin/settings';
import { resolveEditorDocumentKey } from '../platform/obsidian/editor-document-key';
import { createBlockFoldStateManager } from '../drag/move/block-fold-state';
import {
    clearEditorRootClasses,
    ensureEditorRootClasses,
    syncDragSourceHighlightAttr,
    syncDragSourceStyleAttr,
} from './editor-dom-sync';
import { createBlockMoverDeps, createDropPlannerDeps } from './view-runtime';
import { applyViewUpdate } from './editor-update';
import { destroyViewLifecycle, startViewLifecycle } from './editor-lifecycle';
import { placeHandleGutterForConfiguredSide } from '../platform/codemirror/gutter';
import { GlobalPointerMoveClient } from './global-pointermove-router';
import { createHoverPointerSnapshot, HoverPointerSnapshot } from './hover-pointer-snapshot';
import {
    hidePointerDropIndicators,
    performPointerDropAtPoint,
    PointerDragTargetClient,
    registerPointerDragTargetClient,
    schedulePointerDropIndicatorFromPoint,
} from './pointer-drag-target-router';
import { openBlockTypeMenu } from '../plugin/block-type-menu';

export function createDragHandleViewPluginClass(plugin: DragNDropPlugin) {
    return class {
        private readonly view: EditorView;
        private readonly context: EditorContext;
        private readonly dropIndicator: DropIndicatorManager;
        private readonly blockMover: BlockMover;
        private readonly dropPlanner: DropPlanner;
        private readonly dragEventHandler: DragEventHandler;
        private readonly handleVisibility: HandleVisibilityController;
        private readonly orchestrator: DragInteractionOrchestrator;
        private readonly lifecycleEmitter = new DragLifecycleEmitter(
            (event) => plugin.emitDragLifecycleEvent(event)
        );
        private readonly dragPerfManager: DragPerfSessionManager;
        private readonly semanticRefreshScheduler: SemanticRefreshScheduler;
        private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
        private readonly onSettingsUpdated = () => this.handleSettingsUpdated();
        private readonly pointerMoveClient: GlobalPointerMoveClient;
        private readonly pointerDragTargetClient: PointerDragTargetClient;
        private readonly unregisterPointerDragTargetClient: () => void;
        private cachedHandleGutterSide: 'left' | 'right';

        constructor(view: EditorView) {
            this.view = view;
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.context = createEditorContext(this.view);
            this.handleVisibility = new HandleVisibilityController(this.view, {
                getBlockInfoForHandle: (handle) => this.context.dragSource.getBlockInfoForHandle(handle),
                getLineNumberAtVerticalPosition: (clientY, contentRect) => this.context.dragSource.getLineNumberAtVerticalPosition(clientY, contentRect),
                getDraggableBlockAtVerticalPosition: (clientY, contentRect) => this.context.dragSource.getDraggableBlockAtVerticalPosition(clientY, contentRect),
                getVisibleHandleForBlockStart: (blockStart) => getVisibleHandleForBlockStart(this.view, blockStart),
            });
            this.dragPerfManager = new DragPerfSessionManager(this.view);
            this.dropPlanner = new DropPlanner(this.view, createDropPlannerDeps({
                view: this.view,
                context: this.context,
                dragPerfManager: this.dragPerfManager,
            }));
            this.dropIndicator = new DropIndicatorManager(view, (info) =>
                this.dropPlanner.resolveValidatedDropTarget({
                    clientX: info.clientX,
                    clientY: info.clientY,
                    dragSource: info.dragSource ?? getActiveDragSourceBlock(this.view) ?? null,
                    pointerType: info.pointerType ?? null,
                    sourceScope: this.resolveDragSourceScope(),
                })
                , {
                    isDropHighlightEnabled: () => plugin.settings.enableListDropHighlight !== false,
                    recordPerfDuration: (key, durationMs) => {
                        this.dragPerfManager.recordDuration(key, durationMs);
                    },
                    onDropTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                        if (!sourceBlock) return;
                        this.orchestrator.emitDragLifecycle(buildDragTargetChangedLifecycleEvent({
                            sourceBlock,
                            targetLine: validation.plan?.targetLineNumber ?? null,
                            listIntent: buildListIntent(validation.plan?.listIntent),
                            rejectReason: validation.allowed ? null : (validation.reason ?? null),
                            pointerType: pointerType ?? null,
                        }));
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
            this.blockMover = new BlockMover(createBlockMoverDeps({
                context: this.context,
                blockFoldState: createBlockFoldStateManager({
                    app: plugin.app,
                    parseLineWithQuote: this.context.parseLineWithQuote,
                }),
            }));
            this.orchestrator = new DragInteractionOrchestrator({
                view: this.view,
                context: this.context,
                blockMover: this.blockMover,
                dropPlanner: this.dropPlanner,
                handleVisibility: this.handleVisibility,
                dragPerfManager: this.dragPerfManager,
                lifecycleEmitter: this.lifecycleEmitter,
                getSemanticRefreshScheduler: () => this.semanticRefreshScheduler,
                refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
                resolveEditorDocumentKey: (editorView) => resolveEditorDocumentKey(plugin.app, editorView),
                allowCrossDocumentDrop: () => plugin.settings.enableCrossFileDrag === true,
            });
            this.pointerDragTargetClient = {
                containsPoint: (clientX, clientY) => this.containsPoint(clientX, clientY),
                scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                    this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource, pointerType),
                hideDropIndicator: () => this.dropIndicator.hide(),
                performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                    this.orchestrator.performDropAtPoint(sourceBlock, clientX, clientY, pointerType),
            };
            this.unregisterPointerDragTargetClient = registerPointerDragTargetClient(this.pointerDragTargetClient);
            this.dragEventHandler = new DragEventHandler(this.view, {
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
                getVisibleHandleForBlockStart: (blockStart) =>
                    getVisibleHandleForBlockStart(this.view, blockStart),
                isBlockInsideRenderedTableCell: (blockInfo) =>
                    isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                isMultiLineSelectionEnabled: () => plugin.settings.enableMultiLineSelection,
                getMultiLineSelectionLongPressMs: () => plugin.settings.multiLineSelectionLongPressMs,
                isMobileTextLongPressDragEnabled: () => plugin.settings.enableMobileTextLongPressDrag,
                beginPointerDragSession: (blockInfo) => {
                    this.orchestrator.ensureDragPerfSession();
                    beginDragSession(blockInfo, this.view);
                },
                finishDragSession: () => {
                    this.handleVisibility.clearGrabbedLineNumbers();
                    this.handleVisibility.setActiveVisibleHandle(null);
                    finishDragSession(this.view);
                    hidePointerDropIndicators();
                    this.orchestrator.flushDragPerfSession('finish_drag_session');
                    this.refreshDecorationsAndEmbeds();
                },
                scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                    schedulePointerDropIndicatorFromPoint(
                        this.pointerDragTargetClient,
                        clientX,
                        clientY,
                        dragSource,
                        pointerType ?? null
                    ),
                hideDropIndicator: () => this.dropIndicator.hide(),
                performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                    performPointerDropAtPoint(
                        this.pointerDragTargetClient,
                        sourceBlock,
                        clientX,
                        clientY,
                        pointerType ?? null
                    ),
                onDragLifecycleEvent: (event) => {
                    this.handleSourceVisualByLifecycle(event);
                    this.orchestrator.emitDragLifecycle(event);
                },
                openBlockTypeMenu: (blockInfo, event) => {
                    const anchor = Math.max(0, Math.min(this.view.state.doc.length, blockInfo.from));
                    this.view.dispatch({ selection: { anchor }, scrollIntoView: false });
                    openBlockTypeMenu(this.view, event);
                },
            });

            this.semanticRefreshScheduler = new SemanticRefreshScheduler(this.view, {
                performRefresh: () => this.refreshDecorationsAndEmbeds(),
            });
            this.pointerMoveClient = {
                view: this.view,
                onPointerMove: this.onDocumentPointerMove,
                clearPointerHover: () => this.handleVisibility.setActiveVisibleHandle(null),
            };

            startViewLifecycle({
                view: this.view,
                dragEventHandler: this.dragEventHandler,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
            });

            this.syncViewDomState();
        }

        update(update: ViewUpdate) {
            this.syncViewDomState();
            applyViewUpdate(update, {
                refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
                dragEventHandler: this.dragEventHandler,
                handleVisibility: this.handleVisibility,
                semanticRefreshScheduler: this.semanticRefreshScheduler,
                reResolveActiveHandle: () => {
                   // This is technically hard to satisfy without the pointer tracker,
                   // we can safely mock it or grab the center of current active handle.
                   const h = this.handleVisibility.getActiveHandle();
                   if (h) {
                        const rect = h.getBoundingClientRect();
                        this.reResolveActiveHandle(rect.left + rect.width / 2, rect.top + rect.height / 2);
                   }
                },
            });
        }

        destroy(): void {
            destroyViewLifecycle({
                semanticRefreshScheduler: this.semanticRefreshScheduler,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
                dragEventHandler: this.dragEventHandler,
            });
            this.handleVisibility.clearGrabbedLineNumbers();
            this.handleVisibility.setActiveVisibleHandle(null);
            this.unregisterPointerDragTargetClient();
            finishDragSession(this.view);
            this.orchestrator.flushDragPerfSession('destroy');
            clearEditorRootClasses(this.view);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_STYLE_ATTR);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR);
            this.dropIndicator.destroy();
            this.orchestrator.emitDragLifecycle(buildIdleLifecycleEvent());
        }

        private handleDocumentPointerMove(e: PointerEvent): void {
            if (document.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) {
                return;
            }
            if (document.body.classList.contains(DRAGGING_BODY_CLASS)) {
                this.handleVisibility.setActiveVisibleHandle(null);
                return;
            }
            if (this.dragEventHandler.isGestureActive()) {
                this.handleVisibility.setActiveVisibleHandle(this.handleVisibility.getActiveHandle());
                return;
            }
            const hoverSnapshot = this.createHoverPointerSnapshot(e.clientX, e.clientY);
            if (this.semanticRefreshScheduler.isPending && hoverSnapshot.withinHoverActivationZone) {
                this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
            }

            const directHandle = this.handleVisibility.resolveVisibleHandleFromTarget(e.target);
            if (directHandle) {
                this.handleVisibility.setActiveVisibleHandle(directHandle);
                return;
            }

            const handle = this.handleVisibility.resolveVisibleHandleFromPointer(hoverSnapshot);
            this.handleVisibility.setActiveVisibleHandle(handle);
        }

        private reResolveActiveHandle(lastX?: number, lastY?: number): void {
            if (lastX === undefined || lastY === undefined) return;
            const handle = this.handleVisibility.resolveVisibleHandleFromPointer(
                this.createHoverPointerSnapshot(lastX, lastY)
            );
            this.handleVisibility.setActiveVisibleHandle(handle);
        }

        private syncViewDomState(): void {
            ensureEditorRootClasses(this.view);
            placeHandleGutterForConfiguredSide(this.view, this.resolveConfiguredHandleGutterSide());
            syncDragSourceStyleAttr(this.view, normalizeDragSourceVisualStyle(plugin.settings.dragSourceVisualStyle));
            syncDragSourceHighlightAttr(this.view, this.isDragSourceHighlightEnabled());
        }

        private isDragSourceHighlightEnabled(): boolean {
            return plugin.settings.enableDragSourceHighlight !== false;
        }

        private refreshDecorationsAndEmbeds(): void {
            this.syncViewDomState();
            this.semanticRefreshScheduler.clearPendingSemanticRefresh();
        }

        private handleSettingsUpdated(): void {
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.refreshDecorationsAndEmbeds();
            this.dragEventHandler.refreshSelectionVisual();
            this.handleVisibility.refreshGrabVisualState();
        }

        private createHoverPointerSnapshot(clientX: number, clientY: number): HoverPointerSnapshot {
            return createHoverPointerSnapshot(this.view, clientX, clientY, this.cachedHandleGutterSide);
        }

        private containsPoint(clientX: number, clientY: number): boolean {
            const rect = this.view.dom.getBoundingClientRect();
            return clientX >= rect.left
                && clientX <= rect.right
                && clientY >= rect.top
                && clientY <= rect.bottom;
        }

        private resolveConfiguredHandleGutterSide(): 'left' | 'right' {
            return plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
        }

        private handleSourceVisualByLifecycle(event: DragLifecycleEvent): void {
            if (event.type === 'drag_press_pending') {
                if (event.pressReady && event.sourceBlock && this.isDragSourceHighlightEnabled()) {
                    this.handleVisibility.enterGrabVisualStateForBlock(event.sourceBlock, null);
                } else {
                    // Pressing should not show drag-source highlight before long-press is ready.
                    this.handleVisibility.clearGrabbedLineNumbers();
                }
                return;
            }
            if (event.type === 'drag_started') {
                if (event.sourceBlock && this.isDragSourceHighlightEnabled()) {
                    this.handleVisibility.enterGrabVisualStateForBlock(event.sourceBlock, null);
                } else if (!this.isDragSourceHighlightEnabled()) {
                    this.handleVisibility.clearGrabbedLineNumbers();
                }
                return;
            }
            if (event.type === 'drag_cancelled' || event.type === 'drag_idle') {
                if (getActiveDragSourceBlock(this.view)) return;
                this.handleVisibility.clearGrabbedLineNumbers();
                return;
            }
            if (event.type === 'drag_drop_commit') {
                this.handleVisibility.clearGrabbedLineNumbers();
            }
        }

        private resolveDragSourceScope(): DragSourceScope {
            const sourceView = getActiveDragSourceView();
            if (!sourceView || sourceView === this.view) {
                return 'same_editor';
            }
            return 'cross_editor';
        }
    };
}
