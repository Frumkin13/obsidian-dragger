import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import { resolveDragTransferGuard as resolveDragTransferGuardDecision } from './drag-transfer-guard';

export interface NativeDragControllerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    isCrossEditorDragActive?: () => boolean;
    isCrossFileDragEnabled?: () => boolean;
    onAcceptedDragEnter?: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null, pointerType: string | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null) => void;
    finishDragSession: () => void;
}

export class NativeDragController {
    private readonly onEditorDragEnter = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        this.deps.onAcceptedDragEnter?.();
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = transferGuard.dropEffect;
        }
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDragOver = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = transferGuard.dropEffect;
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
            return;
        }
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, this.deps.getDragSourceBlock(e), 'mouse');
    };

    private readonly onEditorDragLeave = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
            return;
        }
        const rect = this.view.dom.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDrop = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        e.preventDefault();
        e.stopPropagation();
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
            return;
        }
        if (!e.dataTransfer) return;
        const sourceBlock = this.deps.getDragSourceBlock(e);
        if (!sourceBlock) return;
        this.deps.performDropAtPoint(sourceBlock, e.clientX, e.clientY, 'mouse');
        this.deps.hideDropIndicator();
        this.deps.finishDragSession();
    };

    constructor(
        private readonly view: EditorView,
        private readonly deps: NativeDragControllerDeps
    ) {}

    attach(): void {
        const editorDom = this.view.dom;
        editorDom.addEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.addEventListener('dragover', this.onEditorDragOver, true);
        editorDom.addEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.addEventListener('drop', this.onEditorDrop, true);
    }

    destroy(): void {
        const editorDom = this.view.dom;
        editorDom.removeEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.removeEventListener('dragover', this.onEditorDragOver, true);
        editorDom.removeEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.removeEventListener('drop', this.onEditorDrop, true);
    }

    private resolveDragTransferGuard(e: DragEvent) {
        return resolveDragTransferGuardDecision({
            event: e,
            isCrossEditorDrag: this.deps.isCrossEditorDragActive?.() ?? false,
            isCrossFileDragEnabled: this.deps.isCrossFileDragEnabled?.() ?? false,
        });
    }
}
