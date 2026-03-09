import type { EditorView } from '@codemirror/view';
import type { App, Editor } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { isEditorLineCollapsed, toggleLineFolds } from './editor-fold';

function createLineElement(options?: {
    classes?: string[];
    hasCollapsedIndicator?: boolean;
}): {
    classList: { contains: (className: string) => boolean };
    closest: (selector: string) => unknown;
    querySelector: (selector: string) => unknown;
} {
    const classes = new Set(options?.classes ?? []);
    const element = {
        classList: {
            contains: (className: string) => classes.has(className),
        },
        closest: (selector: string) => selector === '.cm-line' ? element : null,
        querySelector: () => options?.hasCollapsedIndicator ? {} : null,
    };
    return element;
}

describe('editor-fold', () => {
    it('detects a collapsed line from visible line classes', () => {
        const lineEl = createLineElement({ classes: ['is-collapsed'] });
        const view = {
            state: {
                doc: {
                    line: () => ({ from: 0 }),
                },
            },
            lineBlockAt: () => ({ from: 0 }),
            domAtPos: () => ({ node: lineEl }),
        } as unknown as EditorView;

        expect(isEditorLineCollapsed(view, 1)).toBe(true);
    });

    it('does not treat hidden child lines as independently collapsed', () => {
        const lineEl = createLineElement({ classes: ['is-collapsed'] });
        const view = {
            state: {
                doc: {
                    line: () => ({ from: 10 }),
                },
            },
            lineBlockAt: () => ({ from: 0 }),
            domAtPos: () => ({ node: lineEl }),
        } as unknown as EditorView;

        expect(isEditorLineCollapsed(view, 2)).toBe(false);
    });

    it('toggles folds from deepest line to shallowest line while preserving selection and scroll', () => {
        const setCursor = vi.fn();
        const exec = vi.fn();
        const setSelections = vi.fn();
        const scrollTo = vi.fn();
        const blur = vi.fn();
        const editor = {
            listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
            getScrollInfo: () => ({ left: 12, top: 34 }),
            hasFocus: () => true,
            lineCount: () => 20,
            setCursor,
            exec,
            setSelections,
            scrollTo,
            blur,
        } as unknown as Editor;
        const lineElements = new Map<number, ReturnType<typeof createLineElement>>([
            [5, createLineElement()],
            [7, createLineElement()],
        ]);
        const view = {
            state: {
                doc: {
                    line: (lineNumber: number) => ({ from: lineNumber * 10, text: lineNumber === 5 ? '- parent' : '  - child' }),
                },
            },
            lineBlockAt: (pos: number) => ({ from: pos }),
            domAtPos: (pos: number) => {
                const lineNumber = Math.floor(pos / 10);
                return { node: lineElements.get(lineNumber) ?? createLineElement() };
            },
        } as unknown as EditorView;
        const app = {
            workspace: {
                getLeavesOfType: () => [{
                    view: {
                        getViewType: () => 'markdown',
                        editor: { cm: view, ...editor },
                    },
                }],
            },
        } as unknown as App;
        toggleLineFolds({
            app,
            view,
            targetLineNumbers: [5, 7],
        });

        expect(setCursor).toHaveBeenNthCalledWith(1, { line: 6, ch: 0 });
        expect(setCursor).toHaveBeenNthCalledWith(2, { line: 4, ch: 0 });
        expect(exec).toHaveBeenCalledTimes(2);
        expect(exec).toHaveBeenNthCalledWith(1, 'toggleFold');
        expect(exec).toHaveBeenNthCalledWith(2, 'toggleFold');
        expect(setSelections).toHaveBeenCalledTimes(1);
        expect(scrollTo).toHaveBeenCalledWith(12, 34);
        expect(blur).not.toHaveBeenCalled();
    });
});
