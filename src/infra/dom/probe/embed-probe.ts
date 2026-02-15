import { EditorView } from '@codemirror/view';
import { EMBED_BLOCK_SELECTOR } from '../../../shared/dom-selectors';

export type FindEmbedElementAtPointOptions = {
    fallbackPaddingX?: number;
    requireWithinEditorRect?: boolean;
    requireDirectWithinRoot?: boolean;
    enableFallbackScan?: boolean;
    normalizeToEmbedRoot?: boolean;
};

export function normalizeEmbedRoot(el: HTMLElement | null | undefined): HTMLElement | null {
    if (!el) return null;
    return el.closest<HTMLElement>('.cm-embed-block') ?? el;
}

export function collectEmbedRoots(
    view: EditorView,
    options?: { normalizeToEmbedRoot?: boolean }
): HTMLElement[] {
    const root = view.dom;
    if (!(root instanceof HTMLElement)) return [];
    const normalizeToEmbedRoot = options?.normalizeToEmbedRoot !== false;
    const seen = new Set<HTMLElement>();
    const result: HTMLElement[] = [];
    const raws = Array.from(root.querySelectorAll<HTMLElement>(EMBED_BLOCK_SELECTOR));
    for (const raw of raws) {
        const candidate = normalizeToEmbedRoot ? (normalizeEmbedRoot(raw) ?? raw) : raw;
        if (!root.contains(candidate)) continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        result.push(candidate);
    }
    return result;
}

export function findEmbedElementAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
    options?: FindEmbedElementAtPointOptions,
): HTMLElement | null {
    const root = view.dom;
    if (!(root instanceof HTMLElement)) return null;

    const fallbackPaddingX = options?.fallbackPaddingX ?? 0;
    const requireWithinEditorRect = options?.requireWithinEditorRect !== false;
    const requireDirectWithinRoot = options?.requireDirectWithinRoot !== false;
    const enableFallbackScan = options?.enableFallbackScan !== false;
    const normalizeToEmbedRoot = options?.normalizeToEmbedRoot !== false;

    if (typeof document.elementFromPoint === 'function') {
        const rawEl = document.elementFromPoint(clientX, clientY);
        const el = rawEl instanceof HTMLElement ? rawEl : null;
        if (el) {
            const direct = el.closest<HTMLElement>(EMBED_BLOCK_SELECTOR);
            if (direct) {
                if (!requireDirectWithinRoot || root.contains(direct)) {
                    return normalizeToEmbedRoot ? (normalizeEmbedRoot(direct) ?? direct) : direct;
                }
            }
        }
    }

    if (!enableFallbackScan) return null;

    if (requireWithinEditorRect) {
        const editorRect = root.getBoundingClientRect();
        if (clientY < editorRect.top || clientY > editorRect.bottom) return null;
        if (clientX < editorRect.left || clientX > editorRect.right) return null;
    }

    const embeds = collectEmbedRoots(view, { normalizeToEmbedRoot });
    let best: HTMLElement | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const embed of embeds) {
        const rect = embed.getBoundingClientRect();
        const withinX = clientX >= rect.left - fallbackPaddingX
            && clientX <= rect.right + fallbackPaddingX;
        const withinY = clientY >= rect.top && clientY <= rect.bottom;
        if (!withinX || !withinY) continue;
        const centerY = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(centerY - clientY);
        if (dist < bestDist) {
            bestDist = dist;
            best = embed;
        }
    }
    return best;
}
