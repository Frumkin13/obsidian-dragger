import { EditorView } from '@codemirror/view';

export function isMobileEnvironment(): boolean {
    const body = document.body;
    if (body?.classList.contains('is-mobile') || body?.classList.contains('is-phone') || body?.classList.contains('is-tablet')) {
        return true;
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function shouldStartMobilePressDrag(e: PointerEvent): boolean {
    return e.pointerType === 'touch'
        && e.button === 0;
}

export function shouldDisableMobileTextLongPressDragInInputState(view: EditorView): boolean {
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl) return false;
    if (!view.dom.contains(activeEl)) return false;
    if (activeEl.isContentEditable) return true;
    return activeEl.matches('input, textarea, select');
}
