import { EditorView } from '@codemirror/view';
import { DragSource } from '../shared/types/drag';
import { DROP_HIGHLIGHT_SELECTOR, DROP_INDICATOR_SELECTOR, DRAGGING_BODY_CLASS, HIDDEN_CLASS } from '../shared/dom-selectors';

const activeDragSourceByView = new WeakMap<EditorView, DragSource | null>();
const knownViewRefs = new Set<WeakRef<EditorView>>();

export type ActiveDragSourceEntry = {
    view: EditorView;
    source: DragSource;
};

export function beginDragSession(source: DragSource, view: EditorView): void {
    setActiveDragSource(view, source);
    document.body.classList.add(DRAGGING_BODY_CLASS);
}

export function finishDragSession(view?: EditorView): void {
    if (view) {
        clearActiveDragSource(view);
    } else {
        clearAllActiveDragSources();
    }

    if (!getActiveDragSourceEntry()) {
        document.body.classList.remove(DRAGGING_BODY_CLASS);
    }
    hideDropVisuals();
}

export function setActiveDragSource(view: EditorView, source: DragSource | null): void {
    if (source) {
        activeDragSourceByView.set(view, source);
        knownViewRefs.add(new WeakRef(view));
        return;
    }
    activeDragSourceByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function getActiveDragSource(view?: EditorView): DragSource | null {
    if (view) {
        return activeDragSourceByView.get(view) ?? null;
    }

    return getActiveDragSourceEntry()?.source ?? null;
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
        const source = activeDragSourceByView.get(view);
        if (source) {
            return { view, source };
        }
    }
    return null;
}

export function clearActiveDragSource(view: EditorView): void {
    activeDragSourceByView.delete(view);
    removeWeakRef(knownViewRefs, view);
}

export function clearAllActiveDragSources(): void {
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
        el.classList.add(HIDDEN_CLASS);
    });
    scope.querySelectorAll<HTMLElement>(DROP_HIGHLIGHT_SELECTOR).forEach((el) => {
        el.classList.add(HIDDEN_CLASS);
    });
}
