import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../block/block-types';
import { buildInsertText, getBlockquoteDepthContext } from './structure-mutation';

function createDoc(lines: string[]) {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

describe('block-mutation', () => {
    it.each([BlockType.CodeBlock, BlockType.Table, BlockType.MathBlock])(
        'does not auto-adjust quote depth for %s',
        (type) => {
            const adjustBlockquoteDepth = vi.fn((text: string) => `> ${text}`);
            const adjustListToTargetContext = vi.fn((text: string) => text);
            const result = buildInsertText({
                sourceBlockType: type,
                sourceContent: 'content line',
                adjustListToTargetContext,
            });

            expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
            expect(result).toBe('content line\n');
        }
    );

    it('does not auto-adjust quote depth for callout blocks', () => {
        const adjustBlockquoteDepth = vi.fn((text: string) => text.replace(/^> /gm, ''));
        const result = buildInsertText({
            sourceBlockType: BlockType.Callout,
            sourceContent: '> [!TIP]\n> inside',
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(result).toBe('> [!TIP]\n> inside\n');
    });

    it('does not auto-adjust quote depth for normal paragraph moves', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'plain',
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(result).toBe('plain\n');
    });

    it('does not add trailing blank separation for table rows', () => {
        const result = buildInsertText({
            sourceBlockType: BlockType.Table,
            sourceContent: '| moved |',
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('| moved |\n');
    });

    it('does not inherit quote depth across a blank separator line', () => {
        const doc = createDoc(['> quote', '', 'plain']);
        const depth = getBlockquoteDepthContext(
            doc,
            2,
            (line) => (line.match(/^(\s*> ?)+/)?.[0].match(/>/g) || []).length
        );

        expect(depth).toBe(0);
    });

    it('does not reset quote depth after callout when spacing mutation is removed', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'outside paragraph',
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(result).toBe('outside paragraph\n');
    });

    it('does not force quote reset when inserting between quote lines', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'middle plain',
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(result).toBe('middle plain\n');
    });

    it('does not add an extra separator when moving blockquote content after blockquote', () => {
        const adjustBlockquoteDepth = vi.fn((text: string) => text.replace(/^> /gm, ''));
        const adjustListToTargetContext = vi.fn((text: string) => text.replace(/^- /gm, '1. '));
        const result = buildInsertText({
            sourceBlockType: BlockType.Blockquote,
            sourceContent: '> c',
            adjustListToTargetContext,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(adjustListToTargetContext).not.toHaveBeenCalled();
        expect(result).toBe('> c\n');
    });

    it('keeps blockquote line text unchanged when moved into different quote depth context', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const adjustListToTargetContext = vi.fn((text: string) => text.replace(/- /g, '1. '));
        const source = '> > - keep marker';
        const result = buildInsertText({
            sourceBlockType: BlockType.Blockquote,
            sourceContent: source,
            adjustListToTargetContext,
        });

        expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
        expect(adjustListToTargetContext).not.toHaveBeenCalled();
        expect(result).toBe(`${source}\n`);
    });

    it('does not add trailing blank separation when inserting plain text before a table', () => {
        const result = buildInsertText({
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'before table',
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('before table\n');
    });

    it('does not add leading blank separation when inserting plain text after a table', () => {
        const result = buildInsertText({
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'after table',
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('after table\n');
    });
});


