import { EditorView } from '@codemirror/view';
import {
    DragDocumentRelation,
    DragLifecycleEvent,
    DragSource,
    DragSourceScope,
} from '../../shared/types/drag';
import { buildCancelledLifecycleEvent, buildDropCommitLifecycleEvent } from './pipeline-events';
import { buildListIntent } from '../../shared/utils/drop-protocol';
import { BlockMover } from '../move/block-mover';
import { DropPlanner } from '../drop/drop-planner';
import { DragPerfSessionPort, SemanticRefreshPort } from './drop-commit-ports';

export type DragLifecycleSink = {
    emit(event: DragLifecycleEvent): void;
};

export interface DropCommitPipelineDeps {
    view: EditorView;
    blockMover: BlockMover;
    dropPlanner: DropPlanner;
    dragPerfManager: DragPerfSessionPort;
    lifecycleEmitter: DragLifecycleSink;
    getActiveDragSourceView: () => EditorView | null;
    getSemanticRefreshScheduler: () => SemanticRefreshPort;
    resolveEditorDocumentKey?: (view: EditorView) => string | null;
    allowCrossDocumentDrop?: () => boolean;
}

export class DropCommitPipeline {
    private readonly view: EditorView;
    private readonly blockMover: BlockMover;
    private readonly dropPlanner: DropPlanner;
    private readonly dragPerfManager: DragPerfSessionPort;
    private readonly lifecycleEmitter: DragLifecycleSink;
    private readonly getActiveDragSourceView: () => EditorView | null;
    private readonly getSemanticRefreshScheduler: () => SemanticRefreshPort;
    private readonly resolveEditorDocumentKey?: (view: EditorView) => string | null;
    private readonly allowCrossDocumentDrop?: () => boolean;

    constructor(deps: DropCommitPipelineDeps) {
        this.view = deps.view;
        this.blockMover = deps.blockMover;
        this.dropPlanner = deps.dropPlanner;
        this.dragPerfManager = deps.dragPerfManager;
        this.lifecycleEmitter = deps.lifecycleEmitter;
        this.getActiveDragSourceView = deps.getActiveDragSourceView;
        this.getSemanticRefreshScheduler = deps.getSemanticRefreshScheduler;
        this.resolveEditorDocumentKey = deps.resolveEditorDocumentKey;
        this.allowCrossDocumentDrop = deps.allowCrossDocumentDrop;
    }

    performDropAtPoint(source: DragSource, clientX: number, clientY: number, pointerType: string | null): void {
        this.ensureDragPerfSession();
        const view = this.view;
        const sourceView = this.getActiveDragSourceView();
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
                source,
                rejectReason: 'cross_document_disabled',
                pointerType,
            }));
            return;
        }
        const validation = this.dropPlanner.resolveValidatedDropTarget({
            clientX,
            clientY,
            dragSource: source,
            pointerType,
            sourceScope,
        });
        const listIntent = buildListIntent(validation.plan?.listIntent);
        if (!validation.allowed || !validation.plan) {
            this.emitDragLifecycle(buildCancelledLifecycleEvent({
                source,
                targetLine: validation.plan?.targetLineNumber ?? null,
                listIntent,
                rejectReason: validation.reason ?? 'no_target',
                pointerType,
            }));
            return;
        }

        const targetLineNumber = validation.plan.targetLineNumber;

        this.blockMover.moveBlock({
            source,
            dropPlan: validation.plan,
            sourceView: sourceScope === 'cross_editor' && sourceView ? sourceView : undefined,
            sourceDocumentRelation,
        });
        this.emitDragLifecycle(buildDropCommitLifecycleEvent({
            source,
            targetLine: targetLineNumber,
            listIntent,
            pointerType,
        }));
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
