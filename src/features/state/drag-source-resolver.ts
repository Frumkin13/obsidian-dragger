import { EditorView } from '@codemirror/view';
import { detectBlock, getHeadingSectionRange } from '../../core/block/block-factory';
import { BlockInfo, BlockType } from '../../core/block/block-types';
import { findEmbedElementAtPoint } from '../ui/probe/embed-probe';
import { CODEMIRROR_LINE_SELECTOR, EMBED_ROOT_SELECTOR } from '../../shared/dom-selectors';
import {
    resolveLineNumberAtCoords,
    resolveLineNumberFromBlockStartAttribute,
    resolveLineNumberFromDomNodes,
    resolveLineNumberFromPos,
} from '../ui/probe/element-probe';
import { getRenderedMainLineNumberAtPoint } from '../ui/probe/line-hit';
import { isEditorLineCollapsed } from '../../platform/obsidian/editor-fold';

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

    getDraggableBlockAtVerticalPosition(clientY: number): BlockInfo | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return null;

        try {
            const lineBlock = this.view.lineBlockAtHeight(clientY - this.view.documentTop);
            const lineNumber = resolveLineNumberFromPos(this.view, lineBlock.from);
            if (lineNumber === null) return null;
            return this.getDraggableBlockAtLine(lineNumber);
        } catch {
            return null;
        }
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

        push(embedEl.closest<HTMLElement>(EMBED_ROOT_SELECTOR));
        push(embedEl.closest<HTMLElement>(CODEMIRROR_LINE_SELECTOR));
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
            requireDirectWithinRoot: true,
            normalizeToEmbedRoot: true,
        });
    }

    private expandHeadingBlockIfCollapsed(block: BlockInfo): BlockInfo {
        if (block.type !== BlockType.Heading) return block;
        const headingLineNumber = block.startLine + 1;
        if (!isEditorLineCollapsed(this.view, headingLineNumber)) return block;

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
}



