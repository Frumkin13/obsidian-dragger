// @vitest-environment jsdom

import { BlockType, type EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import {
    getHandleColumnCenterX,
    getHandleTopPxForLine,
    setHandleHorizontalOffsetPx,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from './handle-positioner';
import { setAlignToLineNumber } from '../../../shared/constants';

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

function createRect(left: number, top: number, width: number, height: number): RectLike {
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

function setRect(el: HTMLElement, left: number, top: number, width: number, height: number): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(left, top, width, height),
    });
}

afterEach(() => {
    setHandleHorizontalOffsetPx(0);
    setAlignToLineNumber(true);
    document.body.innerHTML = '';
});

describe('handle-position', () => {
    it('anchors to the current editor line-number gutter and centers inside gutterElement paddings', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';

        const nestedEditor = document.createElement('div');
        nestedEditor.className = 'cm-editor';
        const nestedGutter = document.createElement('div');
        nestedGutter.className = 'cm-gutter cm-lineNumbers';
        const nestedRow = document.createElement('div');
        nestedRow.className = 'cm-gutterElement';
        nestedRow.textContent = '1';
        nestedGutter.appendChild(nestedRow);
        nestedEditor.appendChild(nestedGutter);
        root.appendChild(nestedEditor);

        const scroller = document.createElement('div');
        scroller.className = 'cm-scroller';
        const gutters = document.createElement('div');
        gutters.className = 'cm-gutters';
        const mainGutter = document.createElement('div');
        mainGutter.className = 'cm-gutter cm-lineNumbers';
        const mainRow = document.createElement('div');
        mainRow.className = 'cm-gutterElement';
        mainRow.textContent = '7';
        mainRow.setCssStyles({
            paddingLeft: '12px',
            paddingRight: '4px',
        });
        mainGutter.appendChild(mainRow);
        gutters.appendChild(mainGutter);
        scroller.appendChild(gutters);
        root.appendChild(scroller);

        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 220);
        setRect(content, 80, 0, 280, 220);
        setRect(nestedGutter, 10, 0, 30, 220);
        setRect(nestedRow, 10, 20, 30, 20);
        setRect(mainGutter, 96, 0, 52, 220);
        setRect(mainRow, 100, 20, 40, 20);

        const view = {
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(124, 3);
        setHandleHorizontalOffsetPx(6);
        expect(getHandleColumnCenterX(view)).toBeCloseTo(130, 3);
    });

    it('converts viewport coordinates into local editor coordinates with scale and client border', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        setRect(root, 100, 50, 200, 160);

        Object.defineProperty(root, 'offsetWidth', { configurable: true, value: 100 });
        Object.defineProperty(root, 'offsetHeight', { configurable: true, value: 80 });
        Object.defineProperty(root, 'clientLeft', { configurable: true, value: 3 });
        Object.defineProperty(root, 'clientTop', { configurable: true, value: 5 });

        const view = { dom: root } as unknown as EditorView;
        expect(viewportXToEditorLocalX(view, 140)).toBeCloseTo(17, 6);
        expect(viewportYToEditorLocalY(view, 90)).toBeCloseTo(15, 6);
    });

    it('anchors handle Y by first rendered text block even when line numbers are visible', () => {
        const state = EditorState.create({ doc: 'first\n---\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        const gutter = document.createElement('div');
        gutter.className = 'cm-gutter cm-lineNumbers';
        const row1 = document.createElement('div');
        row1.className = 'cm-gutterElement';
        row1.textContent = '1';
        const row2 = document.createElement('div');
        row2.className = 'cm-gutterElement';
        row2.textContent = '2';
        const row3 = document.createElement('div');
        row3.className = 'cm-gutterElement';
        row3.textContent = '3';
        gutter.appendChild(row1);
        gutter.appendChild(row2);
        gutter.appendChild(row3);
        root.appendChild(gutter);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);
        setRect(gutter, 20, 0, 40, 240);
        // Gutter row intentionally mismatches line block vertical range.
        setRect(row1, 20, 10, 40, 20);
        setRect(row2, 20, 50, 40, 20);
        setRect(row3, 20, 90, 40, 20);

        const line2 = state.doc.line(2);
        const line1 = state.doc.line(1);
        const line3 = state.doc.line(3);
        const view = {
            state,
            dom: root,
            contentDOM: content,
            documentTop: 0,
            defaultLineHeight: 20,
            viewportLineBlocks: [
                { from: line1.from, top: 10, bottom: 30, height: 20, type: BlockType.Text },
                { from: line2.from, top: 70, bottom: 100, height: 30, type: BlockType.Text },
                { from: line3.from, top: 110, bottom: 130, height: 20, type: BlockType.Text },
            ],
            coordsAtPos: (pos: number) => {
                if (pos === line2.from) return createRect(100, 70, 0, 30) as unknown as DOMRect;
                return createRect(100, 10, 0, 20) as unknown as DOMRect;
            },
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(77);
    });

    it('keeps first-text-block Y even when X is not aligned to line numbers', () => {
        setAlignToLineNumber(false);
        const state = EditorState.create({ doc: 'first\nsecond\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        const gutter = document.createElement('div');
        gutter.className = 'cm-gutter cm-lineNumbers';
        const row1 = document.createElement('div');
        row1.className = 'cm-gutterElement';
        row1.textContent = '1';
        const row2 = document.createElement('div');
        row2.className = 'cm-gutterElement';
        row2.textContent = '2';
        const row3 = document.createElement('div');
        row3.className = 'cm-gutterElement';
        row3.textContent = '3';
        gutter.append(row1, row2, row3);
        root.appendChild(gutter);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);
        setRect(gutter, 20, 0, 40, 240);
        setRect(row1, 20, 10, 40, 20);
        setRect(row2, 20, 50, 40, 20);
        setRect(row3, 20, 90, 40, 20);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const view = {
            state,
            dom: root,
            contentDOM: content,
            documentTop: 0,
            viewportLineBlocks: [
                { from: line1.from, top: 10, bottom: 30, height: 20, type: BlockType.Text },
                { from: line2.from, top: 50, bottom: 70, height: 20, type: BlockType.Text },
                { from: line3.from, top: 90, bottom: 110, height: 20, type: BlockType.Text },
            ],
            coordsAtPos: (pos: number) => {
                if (pos === line2.from) return createRect(100, 50, 0, 20) as unknown as DOMRect;
                return createRect(100, 10, 0, 20) as unknown as DOMRect;
            },
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(52);
    });

    it('matches gutter text-block positioning by preferring viewportLineBlocks over lineBlockAt', () => {
        const state = EditorState.create({ doc: 'first\nsecond\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);

        const view = {
            state,
            dom: root,
            contentDOM: content,
            documentTop: 0,
            defaultLineHeight: 20,
            viewportLineBlocks: [
                { from: line1.from, top: 10, bottom: 30, height: 20, type: BlockType.Text },
                {
                    from: line2.from,
                    top: 52,
                    bottom: 94,
                    height: 42,
                    type: [
                        { from: line2.from, top: 70, bottom: 94, height: 24, type: BlockType.Text },
                        { from: line2.from, top: 52, bottom: 68, height: 16, type: BlockType.WidgetBefore },
                    ],
                },
                { from: line3.from, top: 100, bottom: 120, height: 20, type: BlockType.Text },
            ],
            coordsAtPos: (pos: number) => {
                if (pos === line2.from) return createRect(100, 70, 0, 24) as unknown as DOMRect;
                return createRect(100, 10, 0, 20) as unknown as DOMRect;
            },
            lineBlockAt: () => ({
                from: line2.from,
                top: 52,
                bottom: 68,
                height: 16,
                type: BlockType.WidgetBefore,
            }),
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(74);
    });

    it('shows handle for widget-only rendered line (embed-like block)', () => {
        const state = EditorState.create({ doc: 'first\n![[embed]]\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);

        const view = {
            state,
            dom: root,
            contentDOM: content,
            documentTop: 0,
            defaultLineHeight: 20,
            viewportLineBlocks: [
                { from: line1.from, top: 10, bottom: 30, height: 20, type: BlockType.Text },
                { from: line2.from, top: 40, bottom: 104, height: 64, type: BlockType.WidgetBefore },
                { from: line3.from, top: 110, bottom: 130, height: 20, type: BlockType.Text },
            ],
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(42);
    });

    it('aligns code block handle to first line text when viewport block is widget-like', () => {
        const state = EditorState.create({ doc: '```js\nconst a = 1;\n```' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 260);
        setRect(content, 80, 0, 300, 260);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const view = {
            state,
            dom: root,
            contentDOM: content,
            documentTop: 0,
            defaultLineHeight: 20,
            viewportLineBlocks: [
                {
                    from: line1.from,
                    top: 40,
                    bottom: 104,
                    height: 64,
                    type: [
                        { from: line1.from, top: 40, bottom: 56, height: 16, type: BlockType.WidgetBefore },
                        { from: line1.from, top: 58, bottom: 82, height: 24, type: BlockType.Text },
                    ],
                },
                { from: line2.from, top: 86, bottom: 108, height: 22, type: BlockType.Text },
                { from: line3.from, top: 110, bottom: 134, height: 24, type: BlockType.Text },
            ],
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 1);
        expect(top).toBe(62);
    });

    it('uses text block center when line contains rendered code-block preview node', () => {
        const state = EditorState.create({ doc: '```js\nconst a = 1;\n```' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1El = document.createElement('div');
        line1El.className = 'cm-line';
        const preview = document.createElement('div');
        preview.className = 'cm-preview-code-block';
        preview.textContent = 'Code line';
        line1El.appendChild(preview);
        const line2El = document.createElement('div');
        line2El.className = 'cm-line';
        line2El.textContent = 'Code line';
        const line3El = document.createElement('div');
        line3El.className = 'cm-line';
        line3El.textContent = '```';
        content.append(line1El, line2El, line3El);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 280);
        setRect(content, 80, 0, 300, 280);
        setRect(line1El, 80, 40, 300, 120);
        setRect(line2El, 80, 170, 300, 22);
        setRect(line3El, 80, 194, 300, 22);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const originalCreateRange = document.createRange.bind(document);
        const previewFirstRowRect = createRect(92, 54, 220, 24) as unknown as DOMRect;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: () => { },
                getClientRects: () => ({
                    0: previewFirstRowRect,
                    length: 1,
                    item: (index: number) => (index === 0 ? previewFirstRowRect : null),
                }),
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 70, bottom: 94, height: 24, type: BlockType.Text },
                    { from: line2.from, top: 170, bottom: 192, height: 22, type: BlockType.Text },
                    { from: line3.from, top: 194, bottom: 216, height: 22, type: BlockType.Text },
                ],
                posAtDOM: (node: Node) => {
                    if (node === line1El) return line1.from;
                    if (node === line2El) return line2.from;
                    if (node === line3El) return line3.from;
                    throw new Error('unknown node');
                },
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(74);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('uses text block center even when preview line contains formatting nodes', () => {
        const state = EditorState.create({ doc: '```js\nconst a = 1;\n```' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1El = document.createElement('div');
        line1El.className = 'cm-line';
        const preview = document.createElement('div');
        preview.className = 'cm-preview-code-block';
        const formatting = document.createElement('span');
        formatting.className = 'cm-formatting';
        formatting.textContent = '```';
        const codeText = document.createElement('span');
        codeText.textContent = 'Code line';
        preview.append(formatting, codeText);
        line1El.appendChild(preview);
        const line2El = document.createElement('div');
        line2El.className = 'cm-line';
        line2El.textContent = 'Code line';
        const line3El = document.createElement('div');
        line3El.className = 'cm-line';
        line3El.textContent = '```';
        content.append(line1El, line2El, line3El);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 280);
        setRect(content, 80, 0, 300, 280);
        setRect(line1El, 80, 40, 300, 120);
        setRect(line2El, 80, 170, 300, 22);
        setRect(line3El, 80, 194, 300, 22);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const originalCreateRange = document.createRange.bind(document);
        const formattingRect = createRect(92, 38, 24, 18) as unknown as DOMRect;
        const codeRect = createRect(130, 58, 220, 24) as unknown as DOMRect;
        let selectedNode: Node | null = null;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: (node: Node) => {
                    selectedNode = node;
                },
                getClientRects: () => {
                    const parent = selectedNode instanceof Text
                        ? selectedNode.parentElement
                        : (selectedNode instanceof Element ? selectedNode : null);
                    const rect = parent?.closest('.cm-formatting') ? formattingRect : codeRect;
                    return {
                        0: rect,
                        length: 1,
                        item: (index: number) => (index === 0 ? rect : null),
                    };
                },
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 70, bottom: 94, height: 24, type: BlockType.Text },
                    { from: line2.from, top: 170, bottom: 192, height: 22, type: BlockType.Text },
                    { from: line3.from, top: 194, bottom: 216, height: 22, type: BlockType.Text },
                ],
                posAtDOM: (node: Node) => {
                    if (node === line1El) return line1.from;
                    if (node === line2El) return line2.from;
                    if (node === line3El) return line3.from;
                    throw new Error('unknown node');
                },
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(74);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('uses first-row text Y when line contains rendered table widget node', () => {
        const state = EditorState.create({ doc: '| a | b |\n| 1 | 2 |' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1El = document.createElement('div');
        line1El.className = 'cm-line';
        const tableWidget = document.createElement('div');
        tableWidget.className = 'cm-table-widget';
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';
        const table = document.createElement('table');
        table.className = 'table-editor';
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        const firstCellWrapper = document.createElement('div');
        firstCellWrapper.className = 'table-cell-wrapper';
        firstCellWrapper.textContent = '列1';
        th.appendChild(firstCellWrapper);
        tr.appendChild(th);
        thead.appendChild(tr);
        table.appendChild(thead);
        tableWrapper.appendChild(table);
        tableWidget.appendChild(tableWrapper);
        line1El.appendChild(tableWidget);
        const line2El = document.createElement('div');
        line2El.className = 'cm-line';
        line2El.textContent = '| 1 | 2 |';
        content.append(line1El, line2El);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 260);
        setRect(content, 80, 0, 300, 260);
        setRect(line1El, 80, 40, 300, 120);
        setRect(line2El, 80, 170, 300, 22);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const originalCreateRange = document.createRange.bind(document);
        const tableFirstRowRect = createRect(92, 52, 220, 24) as unknown as DOMRect;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: () => { },
                getClientRects: () => ({
                    0: tableFirstRowRect,
                    length: 1,
                    item: (index: number) => (index === 0 ? tableFirstRowRect : null),
                }),
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 70, bottom: 94, height: 24, type: BlockType.Text },
                    { from: line2.from, top: 170, bottom: 192, height: 22, type: BlockType.Text },
                ],
                posAtDOM: (node: Node) => {
                    if (node === line1El) return line1.from;
                    if (node === line2El) return line2.from;
                    throw new Error('unknown node');
                },
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(56);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('uses table-cell-wrapper text when obsidian table drag handles exist', () => {
        const state = EditorState.create({ doc: '| col1 | col2 |' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1El = document.createElement('div');
        line1El.className = 'cm-line';

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';
        const table = document.createElement('table');
        table.className = 'table-editor';
        const th = document.createElement('th');
        const cellWrapper = document.createElement('div');
        cellWrapper.className = 'table-cell-wrapper';
        cellWrapper.textContent = '列1';
        const colHandle = document.createElement('div');
        colHandle.className = 'table-col-drag-handle';
        colHandle.setAttribute('data-ignore-swipe', 'true');
        colHandle.textContent = 'Drag column';
        const rowHandle = document.createElement('div');
        rowHandle.className = 'table-row-drag-handle';
        rowHandle.setAttribute('data-ignore-swipe', 'true');
        rowHandle.textContent = 'Drag row';
        th.append(cellWrapper, colHandle, rowHandle);
        table.appendChild(th);
        tableWrapper.appendChild(table);
        line1El.appendChild(tableWrapper);

        content.append(line1El);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 220);
        setRect(content, 80, 0, 300, 220);
        setRect(line1El, 80, 40, 300, 120);

        const line1 = state.doc.line(1);
        const originalCreateRange = document.createRange.bind(document);
        const cellRect = createRect(92, 60, 100, 24) as unknown as DOMRect;
        const handleRect = createRect(92, 44, 40, 18) as unknown as DOMRect;
        let selectedNode: Node | null = null;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: (node: Node) => {
                    selectedNode = node;
                },
                getClientRects: () => {
                    const parent = selectedNode instanceof Text
                        ? selectedNode.parentElement
                        : (selectedNode instanceof Element ? selectedNode : null);
                    const rect = parent?.closest('.table-col-drag-handle, .table-row-drag-handle')
                        ? handleRect
                        : cellRect;
                    return {
                        0: rect,
                        length: 1,
                        item: (index: number) => (index === 0 ? rect : null),
                    };
                },
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 70, bottom: 94, height: 24, type: BlockType.Text },
                ],
                posAtDOM: (node: Node) => {
                    if (node === line1El) return line1.from;
                    if (node === cellWrapper) return line1.from;
                    throw new Error('unknown node');
                },
                domAtPos: () => ({
                    node: line1El,
                    offset: 0,
                }),
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(64);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('anchors table widget by first-row first-cell text even when domAtPos hits nested cell editor line', () => {
        const state = EditorState.create({ doc: '| col1 | col2 |' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const tableWidget = document.createElement('div');
        tableWidget.className = 'cm-embed-block cm-table-widget markdown-rendered';

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';
        const table = document.createElement('table');
        table.className = 'table-editor';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const headCell = document.createElement('th');
        const headCellWrapper = document.createElement('div');
        headCellWrapper.className = 'table-cell-wrapper';
        headCellWrapper.textContent = '列1';
        const headColHandle = document.createElement('div');
        headColHandle.className = 'table-col-drag-handle';
        headColHandle.setAttribute('data-ignore-swipe', 'true');
        headColHandle.textContent = 'Drag column';
        headCell.append(headCellWrapper, headColHandle);
        headRow.appendChild(headCell);
        thead.appendChild(headRow);

        const tbody = document.createElement('tbody');
        const bodyRow = document.createElement('tr');
        const bodyCell = document.createElement('td');
        const hiddenCellWrapper = document.createElement('div');
        hiddenCellWrapper.className = 'table-cell-wrapper';
        hiddenCellWrapper.textContent = 'A1';
        hiddenCellWrapper.setCssStyles({ display: 'none' });
        const bodyRowHandle = document.createElement('div');
        bodyRowHandle.className = 'table-row-drag-handle';
        bodyRowHandle.setAttribute('data-ignore-swipe', 'true');
        bodyRowHandle.textContent = 'Drag row';
        const innerEditorWrapper = document.createElement('div');
        innerEditorWrapper.className = 'table-cell-wrapper';
        innerEditorWrapper.setAttribute('data-ignore-swipe', 'true');
        const nestedEditor = document.createElement('div');
        nestedEditor.className = 'cm-editor';
        const nestedContent = document.createElement('div');
        nestedContent.className = 'cm-content';
        const nestedLine = document.createElement('div');
        nestedLine.className = 'cm-line';
        nestedLine.textContent = 'A1';
        nestedContent.appendChild(nestedLine);
        nestedEditor.appendChild(nestedContent);
        innerEditorWrapper.appendChild(nestedEditor);
        bodyCell.append(hiddenCellWrapper, bodyRowHandle, innerEditorWrapper);
        bodyRow.appendChild(bodyCell);
        tbody.appendChild(bodyRow);

        table.append(thead, tbody);
        tableWrapper.appendChild(table);
        tableWidget.appendChild(tableWrapper);
        content.appendChild(tableWidget);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);
        setRect(tableWidget, 80, 40, 300, 140);
        setRect(nestedLine, 100, 98, 80, 20);

        const line1 = state.doc.line(1);
        const originalCreateRange = document.createRange.bind(document);
        const headingCellRect = createRect(92, 60, 100, 24) as unknown as DOMRect;
        const nestedLineRect = createRect(96, 98, 40, 20) as unknown as DOMRect;
        let selectedNode: Node | null = null;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: (node: Node) => {
                    selectedNode = node;
                },
                getClientRects: () => {
                    const parent = selectedNode instanceof Text
                        ? selectedNode.parentElement
                        : (selectedNode instanceof Element ? selectedNode : null);
                    const rect = parent?.closest('.cm-line') ? nestedLineRect : headingCellRect;
                    return {
                        0: rect,
                        length: 1,
                        item: (index: number) => (index === 0 ? rect : null),
                    };
                },
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 70, bottom: 94, height: 24, type: BlockType.WidgetBefore },
                ],
                domAtPos: () => ({
                    node: nestedLine,
                    offset: 0,
                }),
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(64);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('prefers heading first-row text Y over text block center when line DOM is available', () => {
        const state = EditorState.create({ doc: '# Heading\nnext' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1El = document.createElement('div');
        line1El.className = 'cm-line';
        line1El.textContent = 'Heading';
        const line2El = document.createElement('div');
        line2El.className = 'cm-line';
        line2El.textContent = 'Next';
        content.append(line1El, line2El);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);
        setRect(line1El, 80, 40, 300, 34);
        setRect(line2El, 80, 80, 300, 20);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const originalCreateRange = document.createRange.bind(document);
        const headingTextRect = createRect(92, 52, 140, 24) as unknown as DOMRect;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: () => { },
                getClientRects: () => ({
                    0: headingTextRect,
                    length: 1,
                    item: (index: number) => (index === 0 ? headingTextRect : null),
                }),
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 40, bottom: 74, height: 34, type: BlockType.Text },
                    { from: line2.from, top: 80, bottom: 100, height: 20, type: BlockType.Text },
                ],
                posAtDOM: (node: Node) => {
                    if (node === line1El) return line1.from;
                    if (node === line2El) return line2.from;
                    throw new Error('unknown node');
                },
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(56);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('ignores line DOM text rect when rendered anchor block is widget-only (code-block-like)', () => {
        const state = EditorState.create({ doc: '```js\nconst a = 1;\n```' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1El = document.createElement('div');
        line1El.className = 'cm-line';
        line1El.textContent = '```js';
        const line2El = document.createElement('div');
        line2El.className = 'cm-line';
        line2El.textContent = 'Code line';
        const line3El = document.createElement('div');
        line3El.className = 'cm-line';
        line3El.textContent = '```';
        content.append(line1El, line2El, line3El);
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 260);
        setRect(content, 80, 0, 300, 260);
        setRect(line1El, 80, 40, 300, 96);
        setRect(line2El, 80, 140, 300, 22);
        setRect(line3El, 80, 166, 300, 22);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const originalCreateRange = document.createRange.bind(document);
        const oversizedRect = createRect(92, 40, 220, 96) as unknown as DOMRect;
        Object.defineProperty(document, 'createRange', {
            configurable: true,
            value: () => ({
                selectNodeContents: () => { },
                getClientRects: () => ({
                    0: oversizedRect,
                    length: 1,
                    item: (index: number) => (index === 0 ? oversizedRect : null),
                }),
            }),
        });

        try {
            const view = {
                state,
                dom: root,
                contentDOM: content,
                documentTop: 0,
                defaultLineHeight: 20,
                viewportLineBlocks: [
                    { from: line1.from, top: 40, bottom: 136, height: 96, type: BlockType.WidgetBefore },
                    { from: line2.from, top: 140, bottom: 162, height: 22, type: BlockType.Text },
                    { from: line3.from, top: 166, bottom: 188, height: 22, type: BlockType.Text },
                ],
                posAtDOM: (node: Node) => {
                    if (node === line1El) return line1.from;
                    if (node === line2El) return line2.from;
                    if (node === line3El) return line3.from;
                    throw new Error('unknown node');
                },
            } as unknown as EditorView;

            const top = getHandleTopPxForLine(view, 1);
            expect(top).toBe(42);
        } finally {
            Object.defineProperty(document, 'createRange', {
                configurable: true,
                value: originalCreateRange,
            });
        }
    });

    it('keeps first-text-block Y even when gutter row center differs', () => {
        const state = EditorState.create({ doc: '# Heading\n|a|b|c|\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        const gutter = document.createElement('div');
        gutter.className = 'cm-gutter cm-lineNumbers';
        const row1 = document.createElement('div');
        row1.className = 'cm-gutterElement';
        row1.textContent = '1';
        const row2 = document.createElement('div');
        row2.className = 'cm-gutterElement';
        row2.textContent = '2';
        row2.setCssStyles({ lineHeight: '24px' });
        const row3 = document.createElement('div');
        row3.className = 'cm-gutterElement';
        row3.textContent = '3';
        gutter.append(row1, row2, row3);
        root.appendChild(gutter);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 260);
        setRect(content, 80, 0, 300, 260);
        setRect(gutter, 20, 0, 40, 260);
        setRect(row1, 20, 10, 40, 20);
        setRect(row2, 20, 50, 40, 32);
        setRect(row3, 20, 100, 40, 20);

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const view = {
            state,
            dom: root,
            contentDOM: content,
            defaultLineHeight: 20,
            documentTop: 0,
            viewportLineBlocks: [
                { from: line1.from, top: 10, bottom: 30, height: 20, type: BlockType.Text },
                { from: line2.from, top: 70, bottom: 94, height: 24, type: BlockType.Text },
                { from: line3.from, top: 100, bottom: 120, height: 20, type: BlockType.Text },
            ],
            coordsAtPos: (pos: number) => {
                if (pos === line2.from) return createRect(100, 70, 0, 24) as unknown as DOMRect;
                return createRect(100, 10, 0, 20) as unknown as DOMRect;
            },
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(74);
    });

    it('returns null when target line has no rendered text block in viewport', () => {
        const state = EditorState.create({ doc: 'first\n---\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);

        const view = {
            state,
            dom: root,
            contentDOM: content,
            documentTop: 0,
            viewportLineBlocks: [],
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBeNull();
    });
});

