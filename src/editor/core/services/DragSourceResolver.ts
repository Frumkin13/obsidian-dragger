import { EditorView } from '@codemirror/view';
import { detectBlock, getHeadingSectionRange } from '../block-detector';
import { BlockInfo, BlockType } from '../../../types';
import { EMBED_BLOCK_SELECTOR } from '../selectors';

const EMBED_HIT_FALLBACK_PADDING_PX = 8;

export class DragSourceResolver {
    constructor(private readonly view: EditorView) { }

    getBlockInfoForHandle(handle: HTMLElement): BlockInfo | null {
        // First, try DOM position for most accurate resolution
        try {
            const pos = this.view.posAtDOM(handle);
            const lineNumber = this.view.state.doc.lineAt(pos).number;
            const block = this.getDraggableBlockAtLine(lineNumber);
            if (block) return block;
        } catch {
            // DOM lookup failed, fall through to attribute-based resolution
        }

        // Fallback to attribute-based resolution when DOM lookup fails (e.g., after scrolling)
        const startAttr = handle.getAttribute('data-block-start');
        const startLine = startAttr !== null ? Number(startAttr) + 1 : NaN;
        if (Number.isInteger(startLine) && startLine >= 1 && startLine <= this.view.state.doc.lines) {
            const block = this.getDraggableBlockAtLine(startLine);
            if (block) return block;
        }

        return null;
    }

    getDraggableBlockAtLine(lineNumber: number): BlockInfo | null {
        const block = detectBlock(this.view.state, lineNumber);
        if (!block) return null;
        return this.expandHeadingBlockIfCollapsed(block);
    }

    getDraggableBlockAtPoint(clientX: number, clientY: number): BlockInfo | null {
        const embedAtPoint = this.getEmbedElementAtPoint(clientX, clientY);
        if (embedAtPoint) {
            const embedBlock = this.getBlockInfoForEmbed(embedAtPoint);
            if (embedBlock) return embedBlock;
        }

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return null;

        const x = Math.min(Math.max(clientX, contentRect.left + 2), contentRect.right - 2);
        let pos: number | null = null;
        try {
            pos = this.view.posAtCoords({ x, y: clientY });
        } catch {
            return null;
        }
        if (pos === null) return null;

        const lineNumber = this.view.state.doc.lineAt(pos).number;
        return this.getDraggableBlockAtLine(lineNumber);
    }

    getBlockInfoForEmbed(embedEl: HTMLElement): BlockInfo | null {
        const candidates = this.collectEmbedProbeCandidates(embedEl);
        for (const candidate of candidates) {
            try {
                const pos = this.view.posAtDOM(candidate);
                const line = this.view.state.doc.lineAt(pos);
                const block = detectBlock(this.view.state, line.number);
                if (block) return this.expandHeadingBlockIfCollapsed(block);
            } catch {
                // try next candidate
            }
        }
        return null;
    }

    private collectEmbedProbeCandidates(embedEl: HTMLElement): HTMLElement[] {
        const seen = new Set<HTMLElement>();
        const candidates: HTMLElement[] = [];
        const push = (el: HTMLElement | null | undefined) => {
            if (!el) return;
            if (seen.has(el)) return;
            seen.add(el);
            candidates.push(el);
        };

        push(embedEl.closest<HTMLElement>('.cm-embed-block'));
        push(embedEl.closest<HTMLElement>('.cm-line'));
        push(embedEl);

        let current: HTMLElement | null = embedEl.parentElement;
        while (current) {
            push(current);
            if (current === this.view.dom) break;
            current = current.parentElement;
        }

        return candidates;
    }

    private getEmbedElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
        const root = this.view.dom;
        if (!(root instanceof HTMLElement)) return null;

        if (typeof document.elementFromPoint === 'function') {
            const rawEl = document.elementFromPoint(clientX, clientY);
            const el = rawEl instanceof HTMLElement ? rawEl : null;
            if (el) {
                const direct = el.closest<HTMLElement>(EMBED_BLOCK_SELECTOR);
                if (direct && root.contains(direct)) {
                    return direct.closest<HTMLElement>('.cm-embed-block') ?? direct;
                }
            }
        }

        const editorRect = root.getBoundingClientRect();
        if (clientY < editorRect.top || clientY > editorRect.bottom) return null;
        if (clientX < editorRect.left || clientX > editorRect.right) return null;

        const embeds = Array.from(root.querySelectorAll<HTMLElement>(EMBED_BLOCK_SELECTOR));
        let best: HTMLElement | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const raw of embeds) {
            const embed = raw.closest<HTMLElement>('.cm-embed-block') ?? raw;
            const rect = embed.getBoundingClientRect();
            const withinX = clientX >= rect.left - EMBED_HIT_FALLBACK_PADDING_PX
                && clientX <= rect.right + EMBED_HIT_FALLBACK_PADDING_PX;
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

    private expandHeadingBlockIfCollapsed(block: BlockInfo): BlockInfo {
        if (block.type !== BlockType.Heading) return block;
        const headingLineNumber = block.startLine + 1;
        if (!this.isHeadingLineCollapsed(headingLineNumber)) return block;

        const range = getHeadingSectionRange(this.view.state.doc, headingLineNumber);
        if (!range || range.endLine <= headingLineNumber) return block;

        const endLineObj = this.view.state.doc.line(range.endLine);
        let content = '';
        for (let i = headingLineNumber; i <= range.endLine; i++) {
            content += this.view.state.doc.line(i).text;
            if (i < range.endLine) content += '\n';
        }

        return {
            ...block,
            endLine: range.endLine - 1,
            to: endLineObj.to,
            content,
        };
    }

    private isHeadingLineCollapsed(lineNumber: number): boolean {
        try {
            const line = this.view.state.doc.line(lineNumber);
            const domAtPos = this.view.domAtPos(line.from);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE ? domAtPos.node.parentElement : domAtPos.node;
            if (!(base instanceof Element)) return false;
            const lineEl = base.closest('.cm-line');
            if (!lineEl) return false;

            if (lineEl.classList.contains('is-collapsed') || lineEl.classList.contains('cm-folded')) {
                return true;
            }

            if (lineEl.querySelector('.cm-foldPlaceholder, .cm-fold-indicator.is-collapsed, .collapse-indicator.is-collapsed')) {
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }
}
