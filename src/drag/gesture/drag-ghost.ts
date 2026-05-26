import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import {
    clearAllActiveDragSourceBlocks,
    clearActiveDragSourceBlock,
    hideDropVisuals,
    setActiveDragSourceBlock,
} from './drag-session';
import { DRAGGING_BODY_CLASS } from '../../shared/dom-selectors';

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

