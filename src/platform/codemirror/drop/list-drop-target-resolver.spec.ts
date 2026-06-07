import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../../domain/block/block-types';
import { createBlockSelection } from '../../../domain/selection/block-selection';
import { parseLineWithQuote } from '../../../domain/markdown/line-parser';
import { createListDropTargetResolver } from './list-drop-target-resolver';

function createViewStub(docText: string): EditorView {
    const state = EditorState.create({ doc: docText });
    const viewStub = {
        state,
        defaultCharacterWidth: 7,
        viewport: { from: 0, to: 100000 },
        documentTop: 0,
        dom: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        lineBlockAt: () => ({ top: 0, bottom: 20 }),
        coordsAtPos: (pos: number) => ({
            left: pos * 2,
            right: pos * 2 + 20,
            top: 0,
            bottom: 20,
        }),
    };
    return viewStub as unknown as EditorView;
}

describe('ListDropTargetResolver', () => {
    it('calls getIndentUnitWidthForDoc once per target computation', () => {
        const view = createViewStub('- root\n- sibling');
        const getIndentUnitWidthForDoc = vi.fn(() => 2);
        const calculator = createListDropTargetResolver(view, {
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getPreviousNonEmptyLineNumber: (_doc, lineNumber) => (lineNumber >= 1 ? lineNumber : null),
            getIndentUnitWidthForDoc,
            getBlockRect: () => ({ top: 0, left: 0, width: 100, height: 20 }),
        });

        const result = calculator.computeListTarget({
            targetLineNumber: 2,
            lineNumber: 1,
            forcedLineNumber: null,
            childIntentOnLine: false,
            selection: createBlockSelection({
                type: BlockType.ListItem,
                startLine: 0,
                endLine: 0,
                from: 0,
                to: 6,
                indentLevel: 0,
                content: '- root',
            }, [{ startLine: 0, endLine: 0 }]),
            clientX: 20,
        });

        expect(result.listIntent?.contextLineNumber).toBeTypeOf('number');
        expect(getIndentUnitWidthForDoc).toHaveBeenCalledTimes(1);
    });



});

