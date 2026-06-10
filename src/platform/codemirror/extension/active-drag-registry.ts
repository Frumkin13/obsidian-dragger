import { EditorView } from '@codemirror/view';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import { DROP_HIGHLIGHT_SELECTOR, DROP_INDICATOR_SELECTOR, DRAGGING_BODY_CLASS, HIDDEN_CLASS } from '../../../shared/dom-selectors';

const activeBlockSelectionByView = new WeakMap<EditorView, BlockSelection | null>();
const knownViewRefs = new Set<WeakRef<EditorView>>();

export type ActiveBlockSelectionEntry = {
    view: EditorView;
    source: BlockSelection;
};

export function beginDragSession(source: BlockSelection, view: EditorView): void {
    setActiveBlockSelection(view, source);
    activeDocument.body.classList.add(DRAGGING_BODY_CLASS);
}

export function finishDragSession(view?: EditorView): void {
    if (view) {
        clearActiveBlockSelection(view);
    } else {
        clearAllActiveBlockSelections();
    }

    if (!getActiveBlockSelectionEntry()) {
        activeDocument.body.classList.remove(DRAGGING_BODY_CLASS);
    }
    hideDropVisuals();
}

export function setActiveBlockSelection(view: EditorView, source: BlockSelection | null): void {
    if (source) {
        activeBlockSelectionByView.set(view, source);
        knownViewRefs.add(new WeakRef(view));
        return;
    }
    activeBlockSelectionByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function getActiveBlockSelection(view?: EditorView): BlockSelection | null {
    if (view) {
        return activeBlockSelectionByView.get(view) ?? null;
    }

    return getActiveBlockSelectionEntry()?.source ?? null;
}

export function getActiveBlockSelectionView(): EditorView | null {
    return getActiveBlockSelectionEntry()?.view ?? null;
}

export function getActiveBlockSelectionEntry(): ActiveBlockSelectionEntry | null {
    for (const ref of knownViewRefs) {
        const view = ref.deref();
        if (!view) {
            knownViewRefs.delete(ref);
            continue;
        }
        const source = activeBlockSelectionByView.get(view);
        if (source) {
            return { view, source };
        }
    }
    return null;
}

export function clearActiveBlockSelection(view: EditorView): void {
    activeBlockSelectionByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function clearAllActiveBlockSelections(): void {
    for (const ref of knownViewRefs) {
        const v = ref.deref();
        if (v) activeBlockSelectionByView.delete(v);
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

export function hideDropVisuals(scope: ParentNode = activeDocument): void {
    scope.querySelectorAll<HTMLElement>(DROP_INDICATOR_SELECTOR).forEach((el) => {
        el.classList.add(HIDDEN_CLASS);
    });
    scope.querySelectorAll<HTMLElement>(DROP_HIGHLIGHT_SELECTOR).forEach((el) => {
        el.classList.add(HIDDEN_CLASS);
    });
}
