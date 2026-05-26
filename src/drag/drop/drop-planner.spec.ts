// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { parseLineWithQuote } from '../../domain/markdown/line-parser';
import { DropTargetCalculator, type DropTargetCalculatorDeps } from './drop-planner';

function originalElementFromPoint(this: void, x: number, y: number): Element | null {
    return document.elementFromPoint(x, y);
}

function createRect(left: number, top: number, width: number, height: number): DOMRect {
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
    } as DOMRect;
}

function createViewStub(docText: string): EditorView {
    const state = EditorState.create({ doc: docText });
    const root = document.createElement('div');
    root.className = 'cm-editor';
    root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    document.body.appendChild(root);

    const viewStub = {
        state,
        dom: root,
        contentDOM: root,
        defaultCharacterWidth: 7,
        viewport: { from: 0, to: 100000 },
        documentTop: 0,
        lineBlockAt: () => ({ top: 0, bottom: 20 }),
        posAtCoords: () => 0,
        coordsAtPos: () => ({ left: 10, right: 110, top: 0, bottom: 20 }),
    };

    return viewStub as unknown as EditorView;
}

function mockElementFromPoint(el: Element | null): void {
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: vi.fn(() => el),
    });
}

function createDeps(overrides?: Partial<DropTargetCalculatorDeps>): DropTargetCalculatorDeps {
    return {
        parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
        getAdjustedTargetLocation: (lineNumber) => ({ lineNumber, blockAdjusted: false }),
        resolveDropRuleAtInsertion: () => ({
            slotContext: 'outside',
            decision: { allowDrop: true },
        }),
        getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
        getIndentUnitWidth: () => 2,
        getBlockInfoForEmbed: () => null,
        getIndentUnitWidthForDoc: () => 2,
        getLineRect: () => ({ left: 10, width: 100 }),
        getInsertionAnchorY: () => 12,
        getLineIndentPosByWidth: () => null,
        getBlockRect: () => ({ top: 0, left: 0, width: 100, height: 20 }),
        listDropTargetCalculator: {
            computeListTarget: () => ({}),
            getListMarkerBounds: () => null,
        },
        onDragTargetEvaluated: () => { },
        ...overrides,
    };
}

function createSourceBlock(content = 'source', startLine = 0, endLine = 0): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

function createListSourceBlock(content = '- item', startLine = 0, endLine = 0): BlockInfo {
    return {
        type: BlockType.ListItem,
        startLine,
        endLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('DropTargetCalculator', () => {
    it('computes a basic drop target from pointer position', () => {
        mockElementFromPoint(null);
        const view = createViewStub('plain line');
        const calculator = new DropTargetCalculator(view, createDeps());

        const target = calculator.getDropTargetInfo({ clientX: 40, clientY: 5 });

        expect(target).not.toBeNull();
        expect(target?.lineNumber).toBe(1);
        expect(target?.indicatorY).toBe(12);
    });

    it('returns null when container policy blocks the drop', () => {
        mockElementFromPoint(null);
        const view = createViewStub('plain line');
        const calculator = new DropTargetCalculator(view, createDeps({
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: false },
            }),
        }));

        const target = calculator.getDropTargetInfo({
            clientX: 40,
            clientY: 5,
            dragSource: createSourceBlock(),
        });

        expect(target).toBeNull();
    });

    it('allows non-list blocks to target the line above a list item', () => {
        mockElementFromPoint(null);
        const view = createViewStub('- first\n- second');
        const calculator = new DropTargetCalculator(view, createDeps());

        const target = calculator.getDropTargetInfo({
            clientX: 40,
            clientY: 5,
            dragSource: createSourceBlock('outside', 5, 5),
        });

        expect(target).not.toBeNull();
        expect(target?.lineNumber).toBe(1);
    });

    it('rejects drop when pointer is inside rendered table cell', () => {
        const view = createViewStub('| h |\n| v |');
        const tableWidget = document.createElement('div');
        tableWidget.className = 'cm-table-widget';
        const cell = document.createElement('div');
        cell.className = 'cm-table-cell';
        const line = document.createElement('div');
        line.className = 'cm-line';
        cell.appendChild(line);
        tableWidget.appendChild(cell);
        view.dom.appendChild(tableWidget);
        mockElementFromPoint(line);

        const calculator = new DropTargetCalculator(view, createDeps());
        const validation = calculator.resolveValidatedDropTarget({
            clientX: 20,
            clientY: 8,
            dragSource: createSourceBlock(),
        });

        expect(validation.allowed).toBe(false);
        expect(validation.reason).toBe('table_cell');
    });

    it('rejects self-range drop before indicator rendering', () => {
        mockElementFromPoint(null);
        const view = createViewStub('- first\n- second');
        const calculator = new DropTargetCalculator(view, createDeps());

        const validation = calculator.resolveValidatedDropTarget({
            clientX: 40,
            clientY: 5,
            dragSource: createListSourceBlock('- first', 0, 0),
        });

        expect(validation.allowed).toBe(false);
        expect(validation.reason).toBe('self_range_blocked');
    });

    it('allows cross-editor scope to bypass self-range rejection', () => {
        mockElementFromPoint(null);
        const view = createViewStub('- first\n- second');
        const calculator = new DropTargetCalculator(view, createDeps());

        const validation = calculator.resolveValidatedDropTarget({
            clientX: 40,
            clientY: 5,
            dragSource: createListSourceBlock('- first', 0, 0),
            sourceScope: 'cross_editor',
        });

        expect(validation.allowed).toBe(true);
        expect(validation.reason).toBeUndefined();
    });

    it('returns no_anchor when insertion anchor cannot be resolved', () => {
        mockElementFromPoint(null);
        const view = createViewStub('plain line');
        const calculator = new DropTargetCalculator(view, createDeps({
            getInsertionAnchorY: () => null,
        }));

        const validation = calculator.resolveValidatedDropTarget({
            clientX: 40,
            clientY: 5,
            dragSource: createSourceBlock('outside', 4, 4),
        });

        expect(validation.allowed).toBe(false);
        expect(validation.reason).toBe('no_anchor');
    });

    it('targets after blank last line when pointer is in the lower half of that blank line', () => {
        mockElementFromPoint(null);
        const state = EditorState.create({ doc: 'first\nsecond\n' });
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 420, 240),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(80, 0, 320, 240),
        });

        const line1 = state.doc.line(1);
        const line2 = state.doc.line(2);
        const line3 = state.doc.line(3);
        const view = {
            state,
            dom: root,
            contentDOM: content,
            defaultCharacterWidth: 7,
            viewport: { from: 0, to: 100000 },
            documentTop: 0,
            lineBlockAt: () => ({ top: 0, bottom: 20 }),
            posAtCoords: () => line3.from,
            coordsAtPos: (pos: number) => {
                if (pos === line1.from || pos === line1.to) return createRect(100, 10, 120, 20);
                if (pos === line2.from || pos === line2.to) return createRect(100, 40, 120, 20);
                if (pos === line3.from || pos === line3.to) return createRect(100, 70, 120, 20);
                return createRect(100, 70, 120, 20);
            },
        } as unknown as EditorView;

        const calculator = new DropTargetCalculator(view, createDeps());
        const validation = calculator.resolveValidatedDropTarget({
            clientX: 120,
            clientY: 89,
            dragSource: createSourceBlock('outside', 8, 8),
        });

        expect(validation.allowed).toBe(true);
        expect(validation.targetLineNumber).toBe(4);
    });

    it('reuses cached validation result for repeated identical input', () => {
        mockElementFromPoint(null);
        const resolveDropRuleAtInsertion = vi.fn(() => ({
            slotContext: 'outside' as const,
            decision: { allowDrop: true },
        }));
        const view = createViewStub('plain line');
        const calculator = new DropTargetCalculator(view, createDeps({
            resolveDropRuleAtInsertion,
        }));

        const source = createSourceBlock('outside', 4, 4);
        const first = calculator.resolveValidatedDropTarget({
            clientX: 40,
            clientY: 5,
            dragSource: source,
            pointerType: 'mouse',
        });
        const second = calculator.resolveValidatedDropTarget({
            clientX: 40,
            clientY: 5,
            dragSource: source,
            pointerType: 'mouse',
        });

        expect(first).toEqual(second);
        expect(resolveDropRuleAtInsertion).toHaveBeenCalledTimes(1);
    });

    it('prefers rendered cm-line hit-testing before posAtCoords for hr lines', () => {
        const state = EditorState.create({ doc: 'first\n---\nthird' });
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        const line1 = document.createElement('div');
        line1.className = 'cm-line';
        const line2 = document.createElement('div');
        line2.className = 'cm-line';
        const hr = document.createElement('hr');
        hr.className = 'cm-hr';
        line2.appendChild(hr);
        const line3 = document.createElement('div');
        line3.className = 'cm-line';
        content.append(line1, line2, line3);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 420, 240),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(80, 0, 320, 240),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => hr),
        });

        const view = {
            state,
            dom: root,
            contentDOM: content,
            defaultCharacterWidth: 7,
            viewport: { from: 0, to: 100000 },
            documentTop: 0,
            lineBlockAt: () => ({ top: 0, bottom: 20 }),
            posAtCoords: () => state.doc.line(1).from,
            posAtDOM: (node: Node) => {
                if (node === line1) return state.doc.line(1).from;
                if (node === line2) return state.doc.line(2).from;
                if (node === line3) return state.doc.line(3).from;
                throw new Error('unexpected node');
            },
            coordsAtPos: () => createRect(100, 10, 120, 20),
        } as unknown as EditorView;

        const calculator = new DropTargetCalculator(view, createDeps());
        const validation = calculator.resolveValidatedDropTarget({
            clientX: 120,
            clientY: 55,
            dragSource: createSourceBlock('outside', 9, 9),
        });

        expect(validation.allowed).toBe(true);
        expect(validation.targetLineNumber).toBe(3);
    });
});

