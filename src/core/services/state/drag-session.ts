import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../shared/types/block-types';
import { DROP_HIGHLIGHT_SELECTOR, DROP_INDICATOR_SELECTOR } from '../../../shared/dom-selectors';

const activeDragSourceByView = new WeakMap<EditorView, BlockInfo | null>();
const knownViewRefs = new Set<WeakRef<EditorView>>();

export type ActiveDragSourceEntry = {
    view: EditorView;
    block: BlockInfo;
};

export function setActiveDragSourceBlock(view: EditorView, block: BlockInfo | null): void {
    if (block) {
        activeDragSourceByView.set(view, block);
        knownViewRefs.add(new WeakRef(view));
        return;
    }
    activeDragSourceByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function getActiveDragSourceBlock(view?: EditorView): BlockInfo | null {
    if (view) {
        return activeDragSourceByView.get(view) ?? null;
    }

    return getActiveDragSourceEntry()?.block ?? null;
}

export function getActiveDragSourceView(): EditorView | null {
    return getActiveDragSourceEntry()?.view ?? null;
}

export function getActiveDragSourceEntry(): ActiveDragSourceEntry | null {
    for (const ref of knownViewRefs) {
        const view = ref.deref();
        if (!view) {
            knownViewRefs.delete(ref);
            continue;
        }
        const block = activeDragSourceByView.get(view);
        if (block) {
            return { view, block };
        }
    }
    return null;
}

export function clearActiveDragSourceBlock(view: EditorView): void {
    activeDragSourceByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function clearAllActiveDragSourceBlocks(): void {
    for (const ref of knownViewRefs) {
        const v = ref.deref();
        if (v) activeDragSourceByView.delete(v);
    }
    knownViewRefs.clear();
}

function removeWeakRef(set: Set<WeakRef<EditorView>>, target: EditorView): void {
    for (const ref of set) {
        const v = ref.deref();
        if (!v || v === target) {
            set.delete(ref);
        }
    }
}

export function hideDropVisuals(scope: ParentNode = document): void {
    scope.querySelectorAll<HTMLElement>(DROP_INDICATOR_SELECTOR).forEach((el) => {
        el.classList.add('dnd-hidden');
    });
    scope.querySelectorAll<HTMLElement>(DROP_HIGHLIGHT_SELECTOR).forEach((el) => {
        el.classList.add('dnd-hidden');
    });
}
