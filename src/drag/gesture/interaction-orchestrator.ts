import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import {
    DragDocumentRelation,
    DragLifecycleEvent,
    DragSourceScope,
} from '../../shared/types/drag';
import { buildCancelledLifecycleEvent, buildDropCommitLifecycleEvent } from './drag-lifecycle-flow';
import { DragLifecycleEmitter } from '../../runtime/drag-lifecycle-emitter';
import { buildListIntent } from '../../shared/utils/drop-protocol';
import { EditorContext } from '../../runtime/drag-service-container';
import { BlockMover } from '../move/block-mover';
import { DropPlanner } from '../drop/drop-planner';
import { HandleVisibilityController } from '../source/handle-visibility-controller';
import { DragPerfSessionPort, SemanticRefreshPort } from './interaction-orchestrator-ports';
import { getActiveDragSourceView } from './drag-session';

export interface DragInteractionOrchestratorDeps {
    view: EditorView;
    context: EditorContext;
    blockMover: BlockMover;
    dropPlanner: DropPlanner;
    handleVisibility: HandleVisibilityController;
    dragPerfManager: DragPerfSessionPort;
    lifecycleEmitter: DragLifecycleEmitter;
    getSemanticRefreshScheduler: () => SemanticRefreshPort;
    refreshDecorationsAndEmbeds: () => void;
    resolveEditorDocumentKey?: (view: EditorView) => string | null;
    allowCrossDocumentDrop?: () => boolean;
}

export class DragInteractionOrchestrator {
    private readonly view: EditorView;
    private readonly context: EditorContext;
    private readonly blockMover: BlockMover;
    private readonly dropPlanner: DropPlanner;
    private readonly handleVisibility: HandleVisibilityController;
    private readonly dragPerfManager: DragPerfSessionPort;
    private readonly lifecycleEmitter: DragLifecycleEmitter;
    private readonly getSemanticRefreshScheduler: () => SemanticRefreshPort;
    private readonly refreshDecorationsAndEmbeds: () => void;
    private readonly resolveEditorDocumentKey?: (view: EditorView) => string | null;
    private readonly allowCrossDocumentDrop?: () => boolean;

    constructor(deps: DragInteractionOrchestratorDeps) {
        this.view = deps.view;
        this.context = deps.context;
        this.blockMover = deps.blockMover;
        this.dropPlanner = deps.dropPlanner;
        this.handleVisibility = deps.handleVisibility;
        this.dragPerfManager = deps.dragPerfManager;
        this.lifecycleEmitter = deps.lifecycleEmitter;
        this.getSemanticRefreshScheduler = deps.getSemanticRefreshScheduler;
        this.refreshDecorationsAndEmbeds = deps.refreshDecorationsAndEmbeds;
        this.resolveEditorDocumentKey = deps.resolveEditorDocumentKey;
        this.allowCrossDocumentDrop = deps.allowCrossDocumentDrop;
    }

    performDropAtPoint(sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null): void {
        this.ensureDragPerfSession();
        const view = this.view;
        const sourceView = getActiveDragSourceView();
        const sourceScope: DragSourceScope = sourceView && sourceView !== view
            ? 'cross_editor'
            : 'same_editor';
        const sourceDocumentRelation = this.resolveDragDocumentRelation(sourceView);
        if (
            sourceScope === 'cross_editor'
            && sourceDocumentRelation === 'different_document'
            && this.allowCrossDocumentDrop?.() !== true
        ) {
            this.emitDragLifecycle(buildCancelledLifecycleEvent({
                sourceBlock,
                rejectReason: 'cross_document_disabled',
                pointerType,
            }));
            return;
        }
        const validation = this.dropPlanner.resolveValidatedDropTarget({
            clientX,
            clientY,
            dragSource: sourceBlock,
            pointerType,
            sourceScope,
        });
        const listIntent = buildListIntent(validation.plan?.listIntent);
        if (!validation.allowed || !validation.plan) {
            this.emitDragLifecycle(buildCancelledLifecycleEvent({
                sourceBlock,
                targetLine: validation.plan?.targetLineNumber ?? null,
                listIntent,
                rejectReason: validation.reason ?? 'no_target',
                pointerType,
            }));
            return;
        }

        const targetLineNumber = validation.plan.targetLineNumber;

        this.blockMover.moveBlock({
            sourceBlock,

            dropPlan: validation.plan,
            sourceView: sourceScope === 'cross_editor' && sourceView ? sourceView : undefined,
            sourceDocumentRelation,
        });
        this.emitDragLifecycle(buildDropCommitLifecycleEvent({
            sourceBlock,
            targetLine: targetLineNumber,
            listIntent,
            pointerType,
        }));
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
                    fromHandle = this.context.dragSource.getBlockInfoForHandle(params.handle);
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
                    fromPoint = this.context.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
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
                const fromPoint = this.context.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
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





