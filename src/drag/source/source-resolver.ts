import { EditorView } from '@codemirror/view';
import { detectBlock, getHeadingSectionRange } from '../../domain/block/block-detector';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { createDragSource, type DragSource } from './source';
import type { DragSourceRequest } from './source-request';
import { findEmbedElementAtPoint } from '../../platform/dom/embed-probe';
import { CODEMIRROR_LINE_SELECTOR, EMBED_ROOT_SELECTOR } from '../../shared/dom-selectors';
import {
    resolveLineNumberAtCoords,
    resolveLineNumberFromBlockStartAttribute,
    resolveLineNumberFromDomNodes,
    resolveLineNumberFromPos,
} from '../../platform/dom/element-probe';
import { getRenderedMainLineNumberAtPoint } from '../../platform/dom/line-hit';
import { isEditorLineCollapsed } from '../../platform/obsidian/editor-fold';

type VerticalContentRect = Pick<DOMRect | DOMRectReadOnly, 'top' | 'bottom'>;

export class DragSourceResolver {
    constructor(private readonly view: EditorView) { }

    resolveSource(request: DragSourceRequest): DragSource | null {
        if (request.kind === 'committed-selection' || request.kind === 'active-selection') {
            return this.cloneSelectionSource(request.selectionSource);
        }

        const block = this.resolvePrimaryBlock(request);
        if (!block) return null;
        return createDragSource(block, [{ startLine: block.startLine, endLine: block.endLine }]);
    }

    getBlockInfoForHandle(handle: HTMLElement): BlockInfo | null {
        // Line handles are absolutely positioned overlays, so DOM position can drift
        // from the bound source line (especially on rendered blocks like `---`).
        // Prefer handle attributes as the authoritative source.
        const startLine = resolveLineNumberFromBlockStartAttribute(this.view, handle);
        if (startLine === null) return null;
        return this.getDraggableBlockAtLine(startLine);
    }

    getDraggableBlockAtLine(lineNumber: number): BlockInfo | null {
        const block = detectBlock(this.view.state, lineNumber);
        if (!block) return null;
        return this.expandHeadingBlockIfCollapsed(block);
    }

    getLineNumberAtVerticalPosition(clientY: number, contentRect?: VerticalContentRect): number | null {
        const activeContentRect = contentRect ?? this.view.contentDOM.getBoundingClientRect();
        if (clientY < activeContentRect.top || clientY > activeContentRect.bottom) return null;

        try {
            const lineBlock = this.view.lineBlockAtHeight(clientY - this.view.documentTop);
            return resolveLineNumberFromPos(this.view, lineBlock.from);
        } catch {
            return null;
        }
    }

    getDraggableBlockAtVerticalPosition(clientY: number, contentRect?: VerticalContentRect): BlockInfo | null {
        const lineNumber = this.getLineNumberAtVerticalPosition(clientY, contentRect);
        if (lineNumber === null) return null;

        return this.getDraggableBlockAtLine(lineNumber);
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

    private resolvePrimaryBlock(request: DragSourceRequest): BlockInfo | null {
        switch (request.kind) {
            case 'handle':
                return this.getBlockInfoForHandle(request.handle)
                    ?? this.getDraggableBlockAtPoint(request.clientX, request.clientY);
            case 'point':
                return this.getDraggableBlockAtPoint(request.clientX, request.clientY);
            default:
                return null;
        }
    }

    private cloneSelectionSource(source: DragSource | null): DragSource | null {
        if (!source) return null;
        return createDragSource(
            source.primaryBlock,
            source.ranges.map((range) => ({ ...range }))
        );
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



