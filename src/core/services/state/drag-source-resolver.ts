import { EditorView } from '@codemirror/view';
import { detectBlock, getHeadingSectionRange } from '../../model/block/block-factory';
import { BlockInfo, BlockType } from '../../../shared/types/block-types';
import { findEmbedElementAtPoint } from '../../../infra/dom/probe/embed-probe';
import {
    resolveLineNumberAtCoords,
    resolveLineNumberFromBlockStartAttribute,
    resolveLineNumberFromDomNodes,
} from '../../../infra/dom/probe/element-probe';
import { getRenderedMainLineNumberAtPoint } from '../../../infra/dom/probe/line-hit';

const EMBED_HIT_FALLBACK_PADDING_PX = 8;

export class DragSourceResolver {
    constructor(private readonly view: EditorView) { }

    getBlockInfoForHandle(handle: HTMLElement): BlockInfo | null {
        // Line handles are absolutely positioned overlays, so DOM position can drift
        // from the bound source line (especially on rendered blocks like `---`).
        // Prefer handle attributes as the authoritative source.
        const startLine = resolveLineNumberFromBlockStartAttribute(this.view, handle);
        if (startLine !== null) {
            const block = this.getDraggableBlockAtLine(startLine);
            if (block) return block;
        }

        // Fallback to DOM lookup for unexpected/legacy handles without attributes.
        const lineNumber = resolveLineNumberFromDomNodes(this.view, [handle]);
        if (lineNumber !== null) {
            const block = this.getDraggableBlockAtLine(lineNumber);
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

        const renderedLineNumber = getRenderedMainLineNumberAtPoint(this.view, clientX, clientY);
        if (renderedLineNumber !== null) {
            const renderedBlock = this.getDraggableBlockAtLine(renderedLineNumber);
            if (renderedBlock) return renderedBlock;
        }

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return null;

        const lineNumber = resolveLineNumberAtCoords(this.view, clientX, clientY, contentRect);
        if (lineNumber === null) return null;
        return this.getDraggableBlockAtLine(lineNumber);
    }

    getBlockInfoForEmbed(embedEl: HTMLElement): BlockInfo | null {
        const candidates = this.collectEmbedProbeCandidates(embedEl);
        for (const candidate of candidates) {
            const lineNumber = resolveLineNumberFromDomNodes(this.view, [candidate]);
            if (lineNumber === null) continue;
            const block = this.getDraggableBlockAtLine(lineNumber);
            if (block) return block;
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
        return findEmbedElementAtPoint(this.view, clientX, clientY, {
            fallbackPaddingX: EMBED_HIT_FALLBACK_PADDING_PX,
            requireWithinEditorRect: true,
            requireDirectWithinRoot: true,
            enableFallbackScan: true,
            normalizeToEmbedRoot: true,
        });
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
