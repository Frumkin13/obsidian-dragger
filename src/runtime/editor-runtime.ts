import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../plugin/main';
import {
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from '../shared/dom-selectors';
import { getActiveDragSourceBlock, getActiveDragSourceView } from '../drag/gesture/drag-session';
import { isPosInsideRenderedTableCell } from '../platform/dom/table-guard';
import { BlockMover } from '../drag/move/block-mover';
import { DropIndicatorManager } from '../drag/drop/drop-indicator';
import { DropPlanner } from '../drag/drop/drop-planner';
import { DragEventHandler } from '../drag/gesture/drag-controller';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
} from '../drag/gesture/drag-ghost';
import { LineHandleManager } from '../drag/source/handle-manager';
import { HandleVisibilityController } from '../drag/source/handle-visibility-controller';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { DragDropServiceContainer } from './drag-service-container';
import { DragLifecycleEmitter, buildListIntent } from './drag-lifecycle-emitter';
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
import { createDropPlannerDeps } from './view-runtime';
import { applyViewUpdate } from './editor-update';
import { destroyViewLifecycle, startViewLifecycle } from './editor-lifecycle';
import { placeHandleGutterHost, reconfigureHandleGutterExtension } from './handle-gutter-extension';
import { getHandleGutterSide } from '../platform/codemirror/gutter';
import { GlobalPointerMoveClient } from './global-pointermove-router';
import { createHoverPointerSnapshot, HoverPointerSnapshot } from './hover-pointer-snapshot';

export function createDragHandleViewPluginClass(plugin: DragNDropPlugin) {
    return class {
        // decorations removed - now using LineHandleManager with independent DOM elements
        private readonly view: EditorView;
        private readonly services: DragDropServiceContainer;
        private readonly dropIndicator: DropIndicatorManager;
        private readonly blockMover: BlockMover;
        private readonly dropPlanner: DropPlanner;
        private readonly lineHandleManager: LineHandleManager;
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
        private handleGutterReconfigureRafId: number | null = null;
        private cachedHandleGutterSide: 'left' | 'right';
        private destroyed = false;

        constructor(view: EditorView) {
            this.view = view;
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.services = new DragDropServiceContainer(this.view);
            this.handleVisibility = new HandleVisibilityController(this.view, {
                getBlockInfoForHandle: (handle) => this.services.dragSource.getBlockInfoForHandle(handle),
                getLineNumberAtVerticalPosition: (clientY, contentRect) => this.services.dragSource.getLineNumberAtVerticalPosition(clientY, contentRect),
                getDraggableBlockAtVerticalPosition: (clientY, contentRect) => this.services.dragSource.getDraggableBlockAtVerticalPosition(clientY, contentRect),
                getVisibleHandleForBlockStart: (blockStart) => this.lineHandleManager.getVisibleHandleForBlockStart(blockStart),
            });
            this.dragPerfManager = new DragPerfSessionManager(this.view);
            this.dropPlanner = new DropPlanner(this.view, createDropPlannerDeps({
                view: this.view,
                services: this.services,
                dragPerfManager: this.dragPerfManager,
                onDragTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                    if (!sourceBlock) return;
                    this.orchestrator.emitDragLifecycle({
                        state: 'drag_active',
                        sourceBlock,
                        targetLine: validation.plan?.targetLineNumber ?? null,
                        listIntent: buildListIntent(validation.plan?.listIntent),
                        rejectReason: validation.allowed ? null : (validation.reason ?? null),
                        pointerType: pointerType ?? null,
                    });
                },
            }));
            this.dropIndicator = new DropIndicatorManager(view, (info) =>
                this.dropPlanner.getDropPlan({
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
                blockFoldState: createBlockFoldStateManager({
                    app: plugin.app,
                    parseLineWithQuote: (line) => this.services.textMutation.parseLineWithQuote(line),
                }),
            });
            this.orchestrator = new DragInteractionOrchestrator({
                view: this.view,
                services: this.services,
                blockMover: this.blockMover,
                dropPlanner: this.dropPlanner,
                handleVisibility: this.handleVisibility,
                dragPerfManager: this.dragPerfManager,
                lifecycleEmitter: this.lifecycleEmitter,
                getSemanticRefreshScheduler: () => this.semanticRefreshScheduler,
                refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
                getDragEventHandler: () => this.dragEventHandler,
                resolveEditorDocumentKey: (editorView) => resolveEditorDocumentKey(plugin.app, editorView),
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
                getVisibleHandleForBlockStart: (blockStart) =>
                    this.lineHandleManager.getVisibleHandleForBlockStart(blockStart),
                isBlockInsideRenderedTableCell: (blockInfo) =>
                    isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                isMultiLineSelectionEnabled: () => plugin.settings.enableMultiLineSelection,
                isRangeSelectionDeleteEnabled: () => plugin.settings.enableMultiSelectionDeleteButton === true,
                getMultiLineSelectionLongPressMs: () => plugin.settings.multiLineSelectionLongPressMs,
                isMobileTextLongPressDragEnabled: () => plugin.settings.enableMobileTextLongPressDrag,
                isCrossEditorDragActive: () => this.resolveDragSourceScope() === 'cross_editor',
                isCrossFileDragEnabled: () => plugin.settings.enableCrossFileDrag === true,
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
            });
            this.pointerMoveClient = {
                view: this.view,
                onPointerMove: this.onDocumentPointerMove,
                clearPointerHover: () => this.handleVisibility.setActiveVisibleHandle(null),
            };

            startViewLifecycle({
                view: this.view,
                lineHandleManager: this.lineHandleManager,
                dragEventHandler: this.dragEventHandler,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
            });

            this.scheduleHandleGutterReconfigureIfNeeded();
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
            this.destroyed = true;
            if (this.handleGutterReconfigureRafId !== null) {
                cancelAnimationFrame(this.handleGutterReconfigureRafId);
                this.handleGutterReconfigureRafId = null;
            }
            destroyViewLifecycle({
                semanticRefreshScheduler: this.semanticRefreshScheduler,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
                dragEventHandler: this.dragEventHandler,
                lineHandleManager: this.lineHandleManager,
            });
            this.handleVisibility.clearGrabbedLineNumbers();
            this.handleVisibility.setActiveVisibleHandle(null);
            finishDragSession(this.view);
            this.orchestrator.flushDragPerfSession('destroy');
            clearEditorRootClasses(this.view);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_STYLE_ATTR);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR);
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
            placeHandleGutterHost(this.view);
            syncDragSourceStyleAttr(this.view, normalizeDragSourceVisualStyle(plugin.settings.dragSourceVisualStyle));
            syncDragSourceHighlightAttr(this.view, this.isDragSourceHighlightEnabled());
        }

        private isDragSourceHighlightEnabled(): boolean {
            return plugin.settings.enableDragSourceHighlight !== false;
        }

        private refreshDecorationsAndEmbeds(): void {
            this.syncViewDomState();
            this.semanticRefreshScheduler.clearPendingSemanticRefresh();
            this.lineHandleManager.scheduleScan();
        }

        private handleSettingsUpdated(): void {
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            if (this.scheduleHandleGutterReconfigureIfNeeded()) {
                return;
            }
            this.syncViewDomState();
            this.refreshDecorationsAndEmbeds();
            this.dragEventHandler.refreshSelectionVisual();
            this.handleVisibility.refreshGrabVisualState();
        }

        private scheduleHandleGutterReconfigureIfNeeded(): boolean {
            const desiredSide = plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
            if (getHandleGutterSide(this.view) === desiredSide) {
                return false;
            }
            if (this.handleGutterReconfigureRafId !== null) {
                return true;
            }
            this.handleGutterReconfigureRafId = requestAnimationFrame(() => {
                this.handleGutterReconfigureRafId = null;
                if (this.destroyed) return;
                reconfigureHandleGutterExtension(this.view, plugin);
                this.syncViewDomState();
                this.refreshDecorationsAndEmbeds();
                this.dragEventHandler.refreshSelectionVisual();
                this.handleVisibility.refreshGrabVisualState();
            });
            return true;
        }

        private createHoverPointerSnapshot(clientX: number, clientY: number): HoverPointerSnapshot {
            return createHoverPointerSnapshot(this.view, clientX, clientY, this.cachedHandleGutterSide);
        }

        private resolveConfiguredHandleGutterSide(): 'left' | 'right' {
            return plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
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

        private resolveDragSourceScope(): DragSourceScope {
            const sourceView = getActiveDragSourceView();
            if (!sourceView || sourceView === this.view) {
                return 'same_editor';
            }
            return 'cross_editor';
        }
    };
}
