import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../core/block/block-types';
import {
    clearAllActiveDragSourceBlocks,
    clearActiveDragSourceBlock,
    getActiveDragSourceBlock,
    getActiveDragSourceView,
    hideDropVisuals,
    setActiveDragSourceBlock,
} from '../../state/drag-session';
import { isPosInsideRenderedTableCell } from '../probe/table-guard';
import { DRAGGING_BODY_CLASS, DRAG_GHOST_CLASS } from '../../../shared/dom-selectors';
import { DND_BLOCK_TRANSFER_MIME_TYPE } from '../../../shared/drag';

const draggingViewRefs = new Set<WeakRef<EditorView>>();

export function beginDragSession(blockInfo: BlockInfo, view: EditorView): void {
    setActiveDragSourceBlock(view, blockInfo);
    draggingViewRefs.add(new WeakRef(view));
    document.body.classList.add(DRAGGING_BODY_CLASS);
}

export function finishDragSession(view?: EditorView): void {
    if (view) {
        finishDragSessionForView(view);
    } else {
        for (const ref of Array.from(draggingViewRefs)) {
            const v = ref.deref();
            if (v) finishDragSessionForView(v);
            draggingViewRefs.delete(ref);
        }
        clearAllActiveDragSourceBlocks();
    }

    if (draggingViewRefs.size === 0) {
        document.body.classList.remove(DRAGGING_BODY_CLASS);
    }
    hideDropVisuals();
}

export function startDragFromHandle(
    e: DragEvent,
    view: EditorView,
    resolveBlockInfo: () => BlockInfo | null,
    handle?: HTMLElement | null
): boolean {
    if (!e.dataTransfer) return false;
    const blockInfo = resolveBlockInfo();
    if (!blockInfo) {
        e.preventDefault();
        return false;
    }
    if (isPosInsideRenderedTableCell(view, blockInfo.from, { skipLayoutRead: true })) {
        e.preventDefault();
        return false;
    }
    return startDragWithBlockInfo(e, blockInfo, view, handle ?? null);
}

export function getDragSourceBlockFromEvent(e: DragEvent, _view?: EditorView): BlockInfo | null {
    const activeSourceView = getActiveDragSourceView();
    if (!activeSourceView) return null;
    const fallbackSource = getActiveDragSourceBlock(activeSourceView);
    if (!e.dataTransfer) return fallbackSource;
    const data = e.dataTransfer.getData(DND_BLOCK_TRANSFER_MIME_TYPE);
    if (!data) return fallbackSource;
    try {
        return JSON.parse(data) as BlockInfo;
    } catch {
        return fallbackSource;
    }
}

function startDragWithBlockInfo(
    e: DragEvent,
    blockInfo: BlockInfo,
    view: EditorView,
    handle?: HTMLElement | null
): boolean {
    if (!e.dataTransfer) return false;
    beginDragSession(blockInfo, view);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', blockInfo.content);
    e.dataTransfer.setData(DND_BLOCK_TRANSFER_MIME_TYPE, JSON.stringify(blockInfo));

    if (handle) {
        handle.setAttribute('data-block-start', String(blockInfo.startLine));
        handle.setAttribute('data-block-end', String(blockInfo.endLine));
    }

    const ghost = document.createElement('div');
    ghost.className = DRAG_GHOST_CLASS;
    ghost.textContent = blockInfo.content.slice(0, 50) + (blockInfo.content.length > 50 ? '...' : '');
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
    return true;
}

function finishDragSessionForView(view: EditorView): void {
    clearActiveDragSourceBlock(view);
    removeDraggingViewRef(view);
}

function removeDraggingViewRef(target: EditorView): void {
    for (const ref of draggingViewRefs) {
        const v = ref.deref();
        if (!v || v === target) {
            draggingViewRefs.delete(ref);
        }
    }
}

