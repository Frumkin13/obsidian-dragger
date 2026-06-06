import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { createDragSource, type DragSource } from '../source/source';
import type { DragSourceRequest } from '../source';
import { buildSelectionSourceParts, buildSingleBlockSourceRanges } from '../source/source-ranges';

type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
};

const originalMatchMedia = window.matchMedia;
const originalVibrate = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate;
let originalElementFromPoint: ((this: void, x: number, y: number) => Element | null) | undefined;

export function createRect(left: number, top: number, width: number, height: number): RectLike {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

export function createBlock(content = '- item', startLine = 0, endLine = startLine): BlockInfo {
    const start = Math.max(0, startLine);
    const end = Math.max(start, endLine);
    return {
        type: BlockType.ListItem,
        startLine: start,
        endLine: end,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

export function resolveDragSourceFromTestBlocks(params: {
    handle?: ((handle: HTMLElement) => BlockInfo | null) | BlockInfo | null;
    point?: ((clientX: number, clientY: number) => BlockInfo | null) | BlockInfo | null;
}): (request: DragSourceRequest) => DragSource | null {
    return (request) => {
        const resolveBlock = (value: ((...args: never[]) => BlockInfo | null) | BlockInfo | null | undefined, args: never[]): BlockInfo | null => {
            if (typeof value === 'function') return value(...args);
            return value ?? null;
        };
        switch (request.kind) {
            case 'handle': {
                const block = resolveBlock(params.handle, [request.handle as never]);
                return block ? createDragSource(block, buildSingleBlockSourceRanges(block)) : null;
            }
            case 'point': {
                const block = resolveBlock(params.point, [request.clientX as never, request.clientY as never]);
                return block ? createDragSource(block, buildSingleBlockSourceRanges(block)) : null;
            }
            case 'block':
                return createDragSource(request.block, buildSingleBlockSourceRanges(request.block));
            case 'selection': {
                const parts = buildSelectionSourceParts(request.doc, request.blocks, request.templateBlock);
                return parts ? createDragSource(parts.primaryBlock, parts.ranges) : null;
            }
        }
    };
}

export function createViewStub(lineCountOrLines: number | string[] = 1): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    const lineTexts = Array.isArray(lineCountOrLines)
        ? lineCountOrLines
        : Array.from({ length: lineCountOrLines }, (_, i) => `line ${i + 1}`);
    const state = EditorState.create({
        doc: lineTexts.join('\n'),
    });
    const lineElements: HTMLElement[] = [];
    for (const text of lineTexts) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-line';
        lineEl.textContent = text;
        content.appendChild(lineEl);
        lineElements.push(lineEl);
    }
    const docLength = state.doc.length;

    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 400, 200),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 360, 200),
    });

    return {
        dom: root,
        contentDOM: content,
        state,
        hasFocus: false,
        visibleRanges: [{ from: 0, to: docLength }],
        coordsAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const top = (line.number - 1) * 20;
            return { left: 40, right: 120, top, bottom: top + 20 };
        },
        posAtCoords: (coords: { x: number; y: number }) => {
            if (!Number.isFinite(coords.y)) return null;
            const lineNumber = Math.max(1, Math.min(state.doc.lines, Math.floor(coords.y / 20) + 1));
            return state.doc.line(lineNumber).from;
        },
        viewport: { from: 0, to: docLength },
        documentTop: 0,
        lineBlockAt: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const top = (line.number - 1) * 20;
            return { from: line.from, to: line.to, top, bottom: top + 20 };
        },
        domAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const node = lineElements[Math.max(0, line.number - 1)] ?? content;
            return { node, offset: 0 };
        },
        posAtDOM: (node: Node) => {
            const lineIndex = Math.max(0, lineElements.findIndex((lineEl) => lineEl === node || lineEl.contains(node)));
            return state.doc.line(Math.min(state.doc.lines, lineIndex + 1)).from;
        },
    } as unknown as EditorView;
}

export function ensureHandleGutter(view: EditorView): HTMLElement {
    const editorRoot = view.dom;
    editorRoot.classList.add('cm-editor');
    const existing = editorRoot.querySelector<HTMLElement>('.cm-dnd-handle-gutter');
    if (existing) return existing;
    const gutter = document.createElement('div');
    gutter.className = 'cm-dnd-handle-gutter';
    editorRoot.appendChild(gutter);
    return gutter;
}

export function appendHandleForBlockStart(
    view: EditorView,
    blockStart: number,
    resolveTop?: () => number,
    blockEnd?: number
): HTMLElement {
    const lineNumber = blockStart + 1;
    const gutter = ensureHandleGutter(view);
    let marker = gutter.querySelector<HTMLElement>(`.cm-gutterElement.dnd-handle-gutter-marker[data-line-number="${lineNumber}"]`);
    if (!marker) {
        marker = document.createElement('div');
        marker.className = 'cm-gutterElement dnd-handle-gutter-marker';
        marker.setAttribute('data-line-number', String(lineNumber));
        Object.defineProperty(marker, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(8, blockStart * 20, 2, 20),
        });
        gutter.appendChild(marker);
    }
    const handle = document.createElement('div');
    handle.className = 'dnd-drag-handle';
    handle.setAttribute('data-block-start', String(blockStart));
    handle.setAttribute('data-block-end', String(blockEnd ?? blockStart));
    Object.defineProperty(handle, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(8, resolveTop ? resolveTop() : (blockStart * 20 + 2), 16, 16),
    });
    marker.appendChild(handle);
    return handle;
}

export function appendHandleGutterMarker(
    view: EditorView,
    lineNumber: number,
    resolveTop?: () => number
): HTMLElement {
    const gutter = ensureHandleGutter(view);
    const marker = document.createElement('div');
    marker.className = 'cm-gutterElement dnd-handle-gutter-marker';
    marker.setAttribute('data-line-number', String(lineNumber));
    Object.defineProperty(marker, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(8, resolveTop ? resolveTop() : ((lineNumber - 1) * 20), 2, 20),
    });
    gutter.appendChild(marker);
    return marker;
}

export function dispatchPointer(
    target: EventTarget,
    type: string,
    init: { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number; buttons?: number; shiftKey?: boolean }
): PointerEvent {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    const inferredButtons = init.buttons ?? (
        init.pointerType === 'mouse'
            ? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1)
            : 0
    );
    Object.defineProperty(event, 'pointerId', { value: init.pointerId });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType });
    Object.defineProperty(event, 'clientX', { value: init.clientX });
    Object.defineProperty(event, 'clientY', { value: init.clientY });
    Object.defineProperty(event, 'button', { value: init.button ?? 0 });
    Object.defineProperty(event, 'buttons', { value: inferredButtons });
    Object.defineProperty(event, 'shiftKey', { value: init.shiftKey ?? false });
    target.dispatchEvent(event);
    return event;
}

export function dispatchTouchMove(target: EventTarget): TouchEvent {
    const event = new Event('touchmove', { bubbles: true, cancelable: true }) as TouchEvent;
    target.dispatchEvent(event);
    return event;
}

export function registerMouseHandlerTestHooks(): void {
    beforeEach(() => {
        if (!originalElementFromPoint && typeof document.elementFromPoint === 'function') {
            const native = document.elementFromPoint.bind(document);
            originalElementFromPoint = (x: number, y: number) => native(x, y);
        }
        vi.useFakeTimers();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: query === '(hover: none) and (pointer: coarse)',
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.body.className = '';
        vi.restoreAllMocks();
        vi.useRealTimers();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: originalMatchMedia,
        });
        Object.defineProperty(window.navigator, 'vibrate', {
            configurable: true,
            writable: true,
            value: originalVibrate,
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: originalElementFromPoint,
        });
    });
}

