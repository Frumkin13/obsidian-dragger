import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../../core/block/block-types';
import { detectBlock, getListItemOwnRangeForHandle } from '../../../core/block/block-factory';
import { getHandleGutterElementForLine } from './handle-gutter';
import { getHandleLeftPxForLine, getHandleTopPxForLine } from './handle-positioner';
import { getHandleSizePx } from '../../../shared/constants';
import { HIDDEN_CLASS, LINE_HANDLE_CLASS } from '../../../shared/dom-selectors';

type LineHandleEntry = {
    handle: HTMLElement;
    lineNumber: number;
};

const GUTTER_BOUND_CLASS = 'dnd-handle-gutter-bound';

export interface LineHandleManagerDeps {
    createHandleElement: (getBlockInfo: () => BlockInfo | null) => HTMLElement;
    getDraggableBlockAtLine: (lineNumber: number) => BlockInfo | null;
    shouldRenderLineHandles?: () => boolean;
}

export class LineHandleManager {
    private readonly lineHandles = new Map<number, LineHandleEntry>();
    private readonly handleSet = new Set<HTMLElement>();
    private pendingScan = false;
    private rafId: number | null = null;
    private destroyed = false;

    constructor(
        private readonly view: EditorView,
        private readonly deps: LineHandleManagerDeps
    ) { }

    private shouldRenderLineHandles(): boolean {
        if (!this.deps.shouldRenderLineHandles) return true;
        return this.deps.shouldRenderLineHandles();
    }

    start(): void {
        this.destroyed = false;
        this.rescan();
    }

    scheduleScan(): void {
        if (this.destroyed) return;
        if (this.pendingScan) return;
        this.pendingScan = true;

        // [Root Cause Fix] Always use RAF for updates instead of sync updates.
        // Sync updates during 'update' cycles (scroll/click) often happen before
        // browser layout is ready, causing coordsAtPos to fail/return null.
        // Deferring to RAF ensures stable layout.
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (this.destroyed) return;
            this.pendingScan = false;
            this.rescan();
        });
    }

    rescan(): void {
        if (this.destroyed) return;
        if (!this.shouldRenderLineHandles()) {
            for (const entry of this.lineHandles.values()) {
                entry.handle.remove();
            }
            this.lineHandles.clear();
            return;
        }

        const doc = this.view.state.doc;
        const processedLines = new Set<number>();
        const handledLineNumbers = new Set<number>();

        for (const { from, to } of this.view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = doc.lineAt(pos);
                const lineNumber = line.number;

                if (processedLines.has(lineNumber)) {
                    pos = line.to + 1;
                    continue;
                }

                const block = detectBlock(this.view.state, lineNumber);
                if (block) {
                    const handleLineNumber = block.startLine + 1;
                    handledLineNumbers.add(handleLineNumber);

                    const getBlockInfo = () => this.deps.getDraggableBlockAtLine(handleLineNumber);

                    let entry = this.lineHandles.get(handleLineNumber);
                    if (!entry) {
                        const handle = this.deps.createHandleElement(getBlockInfo);
                        handle.classList.add(LINE_HANDLE_CLASS);
                        entry = { handle, lineNumber: handleLineNumber };
                        this.lineHandles.set(handleLineNumber, entry);
                        this.handleSet.add(handle);
                    }

                    // Always update attributes with fresh block info
                    entry.handle.setAttribute('data-block-start', String(block.startLine));
                    entry.handle.setAttribute('data-block-end', String(block.endLine));
                    this.mountHandle(entry.handle, handleLineNumber);

                    // Mark processed lines based on block type
                    if (block.type === BlockType.ListItem) {
                        const ownRange = getListItemOwnRangeForHandle(this.view.state, lineNumber);
                        if (ownRange) {
                            for (let i = ownRange.startLine; i <= ownRange.endLine; i++) {
                                processedLines.add(i);
                            }
                        } else {
                            processedLines.add(lineNumber);
                        }
                    } else if (block.type === BlockType.Blockquote) {
                        processedLines.add(lineNumber);
                    } else {
                        const startLineNumber = block.startLine + 1;
                        const endLineNumber = block.endLine + 1;
                        for (let ln = startLineNumber; ln <= endLineNumber; ln++) {
                            processedLines.add(ln);
                        }
                    }
                }

                pos = line.to + 1;
            }
        }

        // Remove handles for lines no longer in view
        for (const [lineNum, entry] of this.lineHandles.entries()) {
            if (!handledLineNumbers.has(lineNum)) {
                this.handleSet.delete(entry.handle);
                entry.handle.remove();
                this.lineHandles.delete(lineNum);
            }
        }
    }

    updateHandlePositions(): void {
        if (!this.shouldRenderLineHandles()) return;
        for (const entry of this.lineHandles.values()) {
            this.mountHandle(entry.handle, entry.lineNumber);
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.pendingScan = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        for (const entry of this.lineHandles.values()) {
            entry.handle.remove();
        }
        this.lineHandles.clear();
        this.handleSet.clear();
    }

    isManagedHandle(handle: HTMLElement): boolean {
        return this.handleSet.has(handle);
    }

    private mountHandle(handle: HTMLElement, lineNumber: number): void {
        // Check if line is in visible range
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
            handle.classList.add(HIDDEN_CLASS);
            return;
        }

        const parent = getHandleGutterElementForLine(this.view, lineNumber);

        if (!parent) {
            handle.classList.add(HIDDEN_CLASS);
            // [Fix] Verify positioning in the next frame if immediate positioning fails.
            if (!this.pendingScan && !this.destroyed) {
                this.scheduleScan();
            }
            return;
        }

        const top = getHandleTopPxForLine(this.view, lineNumber);
        const left = getHandleLeftPxForLine(this.view, lineNumber);
        if (top === null) {
            handle.classList.add(HIDDEN_CLASS);
            if (!this.pendingScan && !this.destroyed) {
                this.scheduleScan();
            }
            return;
        }
        if (left === null) {
            handle.classList.add(HIDDEN_CLASS);
            if (!this.pendingScan && !this.destroyed) {
                this.scheduleScan();
            }
            return;
        }

        if (handle.parentElement !== parent) {
            parent.appendChild(handle);
        }
        const parentRect = parent.getBoundingClientRect();
        const anchorCenterX = left + getHandleSizePx() / 2;
        const anchorCenterY = top + getHandleSizePx() / 2;
        const localAnchorX = anchorCenterX - parentRect.left;
        const localAnchorY = anchorCenterY - parentRect.top;
        handle.setCssStyles({
            left: `${Math.round(localAnchorX)}px`,
            top: `${Math.round(localAnchorY)}px`,
        });
        handle.classList.remove(HIDDEN_CLASS);
        handle.classList.add(GUTTER_BOUND_CLASS);
    }
}

