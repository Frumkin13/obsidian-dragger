import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import {
    DragDocumentRelation,
    DragLifecycleEvent,
    DragSourceScope,
} from '../../shared/types/drag';
import { createDragHandleElement } from '../source/handle-renderer';
import {
    finishDragSession,
    startDragFromHandle,
} from './drag-ghost';
import { buildListIntent, DragLifecycleEmitter } from '../../runtime/drag-lifecycle-emitter';
import { DragDropServiceContainer } from '../../runtime/drag-service-container';
import { BlockMover } from '../move/block-mover';
import { DropPlanner } from '../drop/drop-planner';
import { HandleVisibilityController } from '../source/handle-visibility-controller';
import { DragEventHandlerPort, DragPerfSessionPort, SemanticRefreshPort } from './interaction-orchestrator-ports';
import { getActiveDragSourceView } from './drag-session';

export interface DragInteractionOrchestratorDeps {
    view: EditorView;
    services: DragDropServiceContainer;
    blockMover: BlockMover;
    dropPlanner: DropPlanner;
    handleVisibility: HandleVisibilityController;
    dragPerfManager: DragPerfSessionPort;
    lifecycleEmitter: DragLifecycleEmitter;
    getSemanticRefreshScheduler: () => SemanticRefreshPort;
    refreshDecorationsAndEmbeds: () => void;
    getDragEventHandler: () => DragEventHandlerPort;
    resolveEditorDocumentKey?: (view: EditorView) => string | null;
}

export class DragInteractionOrchestrator {
    private readonly view: EditorView;
    private readonly services: DragDropServiceContainer;
    private readonly blockMover: BlockMover;
    private readonly dropPlanner: DropPlanner;
    private readonly handleVisibility: HandleVisibilityController;
    private readonly dragPerfManager: DragPerfSessionPort;
    private readonly lifecycleEmitter: DragLifecycleEmitter;
    private readonly getSemanticRefreshScheduler: () => SemanticRefreshPort;
    private readonly refreshDecorationsAndEmbeds: () => void;
    private readonly getDragEventHandler: () => DragEventHandlerPort;
    private readonly resolveEditorDocumentKey?: (view: EditorView) => string | null;

    constructor(deps: DragInteractionOrchestratorDeps) {
        this.view = deps.view;
        this.services = deps.services;
        this.blockMover = deps.blockMover;
        this.dropPlanner = deps.dropPlanner;
        this.handleVisibility = deps.handleVisibility;
        this.dragPerfManager = deps.dragPerfManager;
        this.lifecycleEmitter = deps.lifecycleEmitter;
        this.getSemanticRefreshScheduler = deps.getSemanticRefreshScheduler;
        this.refreshDecorationsAndEmbeds = deps.refreshDecorationsAndEmbeds;
        this.getDragEventHandler = deps.getDragEventHandler;
        this.resolveEditorDocumentKey = deps.resolveEditorDocumentKey;
    }

    createHandleElement(getBlockInfo: () => BlockInfo | null): HTMLElement {
        const handle = createDragHandleElement({
            onDragStart: (e, el) => {
                this.getSemanticRefreshScheduler().ensureSemanticReadyForInteraction();
                const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                    handle,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    fallback: getBlockInfo,
                });
                const sourceBlock = resolveCurrentBlock();
                if (sourceBlock) {
                    this.handleVisibility.enterGrabVisualStateForBlock(
                        sourceBlock,
                        el
                    );
                } else {
                    this.handleVisibility.setActiveVisibleHandle(el);
                }
                const started = startDragFromHandle(e, this.view, () => resolveCurrentBlock(), el);
                if (!started) {
                    this.handleVisibility.setActiveVisibleHandle(null);
                    finishDragSession(this.view);
                    this.flushDragPerfSession('drag_start_failed');
                    this.emitDragLifecycle({
                        state: 'cancelled',
                        sourceBlock: sourceBlock ?? null,
                        targetLine: null,
                        listIntent: null,
                        rejectReason: 'drag_start_failed',
                        pointerType: 'mouse',
                    });
                    this.emitDragLifecycle({
                        state: 'idle',
                        sourceBlock: null,
                        targetLine: null,
                        listIntent: null,
                        rejectReason: null,
                        pointerType: null,
                    });
                    return;
                }
                this.ensureDragPerfSession();
                this.emitDragLifecycle({
                    state: 'drag_active',
                    sourceBlock: sourceBlock ?? null,
                    targetLine: null,
                    listIntent: null,
                    rejectReason: null,
                    pointerType: 'mouse',
                });
            },
            onDragEnd: () => {
                this.handleVisibility.clearGrabbedLineNumbers();
                this.handleVisibility.setActiveVisibleHandle(null);
                finishDragSession(this.view);
                this.flushDragPerfSession('drag_end');
                this.refreshDecorationsAndEmbeds();
                this.emitDragLifecycle({
                    state: 'idle',
                    sourceBlock: null,
                    targetLine: null,
                    listIntent: null,
                    rejectReason: null,
                    pointerType: null,
                });
            },
        });
        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            this.getSemanticRefreshScheduler().ensureSemanticReadyForInteraction();
            const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                handle,
                clientX: e.clientX,
                clientY: e.clientY,
                fallback: getBlockInfo,
            });
            this.handleVisibility.setActiveVisibleHandle(handle);
            this.getDragEventHandler().startPointerDragFromHandle(handle, e, () => resolveCurrentBlock());
        });
        return handle;
    }

    performDropAtPoint(sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null): void {
        this.ensureDragPerfSession();
        const view = this.view;
        const sourceView = getActiveDragSourceView();
        const sourceScope: DragSourceScope = sourceView && sourceView !== view
            ? 'cross_editor'
            : 'same_editor';
        const sourceDocumentRelation = this.resolveDragDocumentRelation(sourceView);
        const validation = this.dropPlanner.resolveValidatedDropTarget({
            clientX,
            clientY,
            dragSource: sourceBlock,
            pointerType,
            sourceScope,
        });
        const listIntent = buildListIntent(validation.plan?.listIntent);
        if (!validation.allowed || !validation.plan) {
            this.emitDragLifecycle({
                state: 'cancelled',
                sourceBlock,
                targetLine: validation.plan?.targetLineNumber ?? null,
                listIntent,
                rejectReason: validation.reason ?? 'no_target',
                pointerType,
            });
            return;
        }

        const targetLineNumber = validation.plan.targetLineNumber;

        this.blockMover.moveBlock({
            sourceBlock,

            dropPlan: validation.plan,
            sourceView: sourceScope === 'cross_editor' && sourceView ? sourceView : undefined,
            sourceDocumentRelation,
        });
        this.emitDragLifecycle({
            state: 'drop_commit',
            sourceBlock,
            targetLine: targetLineNumber,
            listIntent,
            rejectReason: null,
            pointerType,
        });
    }

    resolveInteractionBlockInfo(params: {
        handle?: HTMLElement | null;
        clientX: number;
        clientY: number;
        fallback?: () => BlockInfo | null;
        allowRefreshRetry?: boolean;
    }): BlockInfo | null {
        const allowRefreshRetry = params.allowRefreshRetry !== false;
        const resolveOnce = (): BlockInfo | null => {
            if (params.handle) {
                let fromHandle: BlockInfo | null = null;
                try {
                    fromHandle = this.services.dragSource.getBlockInfoForHandle(params.handle);
                } catch {
                    fromHandle = null;
                }
                if (fromHandle) {
                    this.syncHandleBlockAttributes(params.handle, fromHandle);
                    return fromHandle;
                }
            }

            if (Number.isFinite(params.clientX) && Number.isFinite(params.clientY)) {
                let fromPoint: BlockInfo | null = null;
                try {
                    fromPoint = this.services.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
                } catch {
                    fromPoint = null;
                }
                if (fromPoint) {
                    this.syncHandleBlockAttributes(params.handle ?? null, fromPoint);
                    return fromPoint;
                }
            }

            const fromFallback = params.fallback?.() ?? null;
            if (fromFallback) {
                this.syncHandleBlockAttributes(params.handle ?? null, fromFallback);
            }
            return fromFallback;
        };

        const first = resolveOnce();
        if (first || !allowRefreshRetry) return first;

        // Refresh decorations and retry - use coordinates since handle may be stale
        this.refreshDecorationsAndEmbeds();

        if (Number.isFinite(params.clientX) && Number.isFinite(params.clientY)) {
            try {
                const fromPoint = this.services.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
                if (fromPoint) {
                    this.syncHandleBlockAttributes(params.handle ?? null, fromPoint);
                    return fromPoint;
                }
            } catch {
                // fall through
            }
        }

        return params.fallback?.() ?? null;
    }

    ensureDragPerfSession(): void {
        this.getSemanticRefreshScheduler().ensureSemanticReadyForInteraction();
        this.dragPerfManager.ensure();
    }

    flushDragPerfSession(reason: string): void {
        this.dragPerfManager.flush(reason);
    }

    emitDragLifecycle(event: DragLifecycleEvent): void {
        this.lifecycleEmitter.emit(event);
    }

    private syncHandleBlockAttributes(handle: HTMLElement | null, blockInfo: BlockInfo): void {
        if (!handle || !handle.isConnected) return;
        handle.setAttribute('data-block-start', String(blockInfo.startLine));
        handle.setAttribute('data-block-end', String(blockInfo.endLine));
    }

    private resolveDragDocumentRelation(sourceView: EditorView | null): DragDocumentRelation {
        if (!sourceView || sourceView === this.view) {
            return 'same_document';
        }
        const resolveDocumentKey = this.resolveEditorDocumentKey;
        if (!resolveDocumentKey) {
            return 'different_document';
        }
        const sourceDocumentKey = resolveDocumentKey(sourceView);
        const targetDocumentKey = resolveDocumentKey(this.view);
        if (!sourceDocumentKey || !targetDocumentKey) {
            return 'different_document';
        }
        return sourceDocumentKey === targetDocumentKey
            ? 'same_document'
            : 'different_document';
    }
}





