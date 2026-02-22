import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../../shared/types/block-types';
import { BlockMover } from './standard-move';
import { parseLineWithQuote } from '../../../core/services/parser/line-parser';

function createBlockFromLine(doc: EditorState['doc'], lineNumber: number): BlockInfo {
    const line = doc.line(lineNumber);
    return {
        type: BlockType.Paragraph,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        indentLevel: 0,
        content: line.text,
    };
}

function createListBlock(doc: EditorState['doc'], startLine: number, endLine: number): BlockInfo {
    const start = doc.line(startLine);
    const end = doc.line(endLine);
    return {
        type: BlockType.ListItem,
        startLine: startLine - 1,
        endLine: endLine - 1,
        from: start.from,
        to: end.to,
        indentLevel: 0,
        content: doc.sliceString(start.from, end.to),
    };
}

function createMutableView(state: EditorState): {
    view: EditorView;
    dispatch: ReturnType<typeof vi.fn>;
    getState: () => EditorState;
} {
    let currentState = state;
    const dispatch = vi.fn((tr: Parameters<EditorState['update']>[0]) => {
        currentState = currentState.update(tr).state;
    });
    const view = {
        get state() {
            return currentState;
        },
        dispatch,
    } as unknown as EditorView;
    return {
        view,
        dispatch,
        getState: () => currentState,
    };
}

function createLinkedViews(state: EditorState): {
    sourceView: EditorView;
    targetView: EditorView;
    sourceDispatch: ReturnType<typeof vi.fn>;
    targetDispatch: ReturnType<typeof vi.fn>;
    getState: () => EditorState;
} {
    let currentState = state;
    const sourceDispatch = vi.fn((tr: Parameters<EditorState['update']>[0]) => {
        currentState = currentState.update(tr).state;
    });
    const targetDispatch = vi.fn((tr: Parameters<EditorState['update']>[0]) => {
        currentState = currentState.update(tr).state;
    });
    const sourceView = {
        get state() {
            return currentState;
        },
        dispatch: sourceDispatch,
    } as unknown as EditorView;
    const targetView = {
        get state() {
            return currentState;
        },
        dispatch: targetDispatch,
    } as unknown as EditorView;
    return {
        sourceView,
        targetView,
        sourceDispatch,
        targetDispatch,
        getState: () => currentState,
    };
}

describe('BlockMover', () => {
    it('skips dispatch when container policy blocks the drop', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: false },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(state.doc, 1),
            targetPos: state.doc.line(3).from,
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('dispatches insert+delete changes when drop is allowed', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(state.doc, 1),
            targetPos: state.doc.line(3).from,
        });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const payload = dispatch.mock.calls[0][0];
        expect(Array.isArray(payload.changes)).toBe(true);
        expect(payload.changes).toHaveLength(2);
        setTimeoutSpy.mockRestore();
    });

    it('moves a single block across editor views', () => {
        const sourceInitialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const targetInitialState = EditorState.create({ doc: 'one\ntwo' });
        const { view: sourceView, getState: getSourceState } = createMutableView(sourceInitialState);
        const { view: targetView, getState: getTargetState } = createMutableView(targetInitialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const mover = new BlockMover({
            view: targetView,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(sourceInitialState.doc, 2),
            targetPos: targetInitialState.doc.line(2).from,
            targetLineNumberOverride: 2,
            sourceView,
        });

        expect(getTargetState().doc.toString()).toBe('one\nbeta\ntwo');
        expect(getSourceState().doc.toString()).toBe('alpha\ngamma');
        setTimeoutSpy.mockRestore();
    });

    it('moves a composite source across editor views', () => {
        const sourceInitialState = EditorState.create({ doc: 'alpha\nbeta\ngamma\ndelta\nepsilon' });
        const targetInitialState = EditorState.create({ doc: 'one\ntwo' });
        const { view: sourceView, getState: getSourceState } = createMutableView(sourceInitialState);
        const { view: targetView, getState: getTargetState } = createMutableView(targetInitialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const mover = new BlockMover({
            view: targetView,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = sourceInitialState.doc.line(2);
        const line4 = sourceInitialState.doc.line(4);
        mover.moveBlock({
            sourceBlock: {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 3,
                from: line2.from,
                to: line4.to,
                indentLevel: 0,
                content: 'beta\ndelta',
                compositeSelection: {
                    ranges: [
                        { startLine: 1, endLine: 1 },
                        { startLine: 3, endLine: 3 },
                    ],
                },
            },
            targetPos: targetInitialState.doc.line(2).from,
            targetLineNumberOverride: 2,
            sourceView,
        });

        expect(getTargetState().doc.toString()).toBe('one\nbeta\ndelta\ntwo');
        expect(getSourceState().doc.toString()).toBe('alpha\ngamma\nepsilon');
        setTimeoutSpy.mockRestore();
    });

    it('uses a single-document transaction for same-file cross-window moves', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const {
            sourceView,
            targetView,
            sourceDispatch,
            targetDispatch,
            getState,
        } = createLinkedViews(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view: targetView,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 2),
            targetPos: initialState.doc.line(1).from,
            targetLineNumberOverride: 1,
            sourceView,
            sourceDocumentRelation: 'same_document',
        });

        expect(getState().doc.toString()).toBe('beta\nalpha\ngamma');
        expect(targetDispatch).toHaveBeenCalledTimes(1);
        expect(sourceDispatch).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
    });

    it('prevents self-embedding indent when dropping list root at its own tail', () => {
        const state = EditorState.create({ doc: '- root\n  - child\nafter' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createListBlock(state.doc, 1, 2),
            targetPos: state.doc.line(3).from,
            targetLineNumberOverride: 3,
            listContextLineNumberOverride: 2,
            listTargetIndentWidthOverride: 2,
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('moves composite multi-range source as ordered group', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = state.doc.line(2);
        const line5 = state.doc.line(5);
        mover.moveBlock({
            sourceBlock: {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 4,
                from: line2.from,
                to: line5.to,
                indentLevel: 0,
                content: 'b\ne',
                compositeSelection: {
                    ranges: [
                        { startLine: 1, endLine: 1 },
                        { startLine: 4, endLine: 4 },
                    ],
                },
            },
            targetPos: state.doc.line(1).from,
            targetLineNumberOverride: 1,
        });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const payload = dispatch.mock.calls[0][0];
        expect(Array.isArray(payload.changes)).toBe(true);
        expect(payload.changes).toHaveLength(3);
        const insertChange = payload.changes.find((change: { insert?: string }) => typeof change.insert === 'string');
        expect(insertChange?.insert).toContain('b');
        expect(insertChange?.insert).toContain('e');
        setTimeoutSpy.mockRestore();
    });

    it('allows composite move into unselected gap between selected ranges', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = state.doc.line(2);
        const line5 = state.doc.line(5);
        mover.moveBlock({
            sourceBlock: {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 4,
                from: line2.from,
                to: line5.to,
                indentLevel: 0,
                content: 'b\ne',
                compositeSelection: {
                    ranges: [
                        { startLine: 1, endLine: 1 },
                        { startLine: 4, endLine: 4 },
                    ],
                },
            },
            targetPos: state.doc.line(3).from,
            targetLineNumberOverride: 3,
        });

        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('moves block to end without merging with existing last line content', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 1),
            targetPos: initialState.doc.length,
            targetLineNumberOverride: initialState.doc.lines + 1,
        });

        expect(getState().doc.toString()).toBe('beta\ngamma\nalpha');
        setTimeoutSpy.mockRestore();
    });

    it('moves last line to another position without leaving an extra trailing blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 3),
            targetPos: initialState.doc.line(1).from,
            targetLineNumberOverride: 1,
        });

        expect(getState().doc.toString()).toBe('gamma\nalpha\nbeta');
        setTimeoutSpy.mockRestore();
    });

    it('moves last text line out of a terminal blank-line document while preserving terminal blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 2),
            targetPos: initialState.doc.line(1).from,
            targetLineNumberOverride: 1,
        });

        expect(getState().doc.toString()).toBe('beta\nalpha\n');
        setTimeoutSpy.mockRestore();
    });

    it('moves last text line to the blank-tail insertion slot without dropping a line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 2),
            targetPos: initialState.doc.line(initialState.doc.lines).from,
            targetLineNumberOverride: initialState.doc.lines,
        });

        expect(getState().doc.toString()).toBe('alpha\nbeta\n');
        setTimeoutSpy.mockRestore();
    });

    it('moves a non-terminal source into penultimate line without removing trailing blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 1),
            targetPos: initialState.doc.line(initialState.doc.lines).from,
            targetLineNumberOverride: initialState.doc.lines,
        });

        expect(getState().doc.toString()).toBe('beta\ngamma\nalpha\n');
        setTimeoutSpy.mockRestore();
    });

    it('moves last text line after terminal blank slot without dropping a line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 2),
            targetPos: initialState.doc.length,
            targetLineNumberOverride: initialState.doc.lines + 1,
        });

        expect(getState().doc.toString()).toBe('alpha\n\nbeta');
        setTimeoutSpy.mockRestore();
    });

    it('moves block into trailing empty last line while preserving terminal blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 1),
            targetPos: initialState.doc.line(initialState.doc.lines).from,
            targetLineNumberOverride: initialState.doc.lines,
        });

        expect(getState().doc.toString()).toBe('beta\nalpha\n');
        setTimeoutSpy.mockRestore();
    });

    it('keeps trailing empty line when targeting after the final blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const mover = new BlockMover({
            view,
            getAdjustedTargetLocation: (lineNumber: number) => ({ lineNumber, blockAdjusted: false }),
            resolveDropRuleAtInsertion: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            buildInsertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        mover.moveBlock({
            sourceBlock: createBlockFromLine(initialState.doc, 1),
            targetPos: initialState.doc.length,
            targetLineNumberOverride: initialState.doc.lines + 1,
        });

        expect(getState().doc.toString()).toBe('beta\n\nalpha');
        setTimeoutSpy.mockRestore();
    });
});
