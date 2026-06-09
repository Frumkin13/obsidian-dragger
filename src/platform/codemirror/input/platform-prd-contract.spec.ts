import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const inputRoot = join(process.cwd(), 'src', 'platform', 'codemirror', 'input');

function collectProductionTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectProductionTsFiles(path));
            continue;
        }
        if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test-helpers.ts')) {
            files.push(path);
        }
    }
    return files;
}

function readInputProductionFiles(): Array<{ rel: string; text: string }> {
    return collectProductionTsFiles(inputRoot).map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

describe('CodeMirror input PRD contracts', () => {
    it('keeps drag selection policy out of platform input translation', () => {
        const offenders = readInputProductionFiles()
            .filter((file) => /from ['"].*\/drag\/selection\/block-range-selection['"]/.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('keeps platform input from constructing drag range-selection state directly', () => {
        const forbidden = /\b(?:createBlockRangeSelectionState|updateBlockRangeSelectionState)\b/;
        const offenders = readInputProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('keeps mobile drag mode as a text-source guard instead of a handle-source gate', () => {
        const offenders = readInputProductionFiles()
            .filter((file) => /source\s*===\s*['"]handle['"][\s\S]{0,240}isMobileDragModeEnabled|isMobileDragModeEnabled[\s\S]{0,240}source\s*===\s*['"]handle['"]/.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('keeps pointerdown translation on a single platform adapter path', () => {
        const forbidden = /\b(?:handleDesktopPointerDown|handleMobilePointerDown|decideDesktopPointerDownAction)\b/;
        const offenders = readInputProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('keeps passive range selection inside the drag pipeline state', () => {
        const forbidden = /\bcommittedRangeSelection\b|\bCommittedRangeSelection\b/;
        const offenders = readInputProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('keeps platform input behind the DragPipeline object API', () => {
        const forbidden = /\breducePipeline\b|from ['"].*pipeline-reducer['"]/;
        const offenders = readInputProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('keeps pointer selection translation from mirroring the adapter as host interfaces', () => {
        const forbidden = /\b(?:RangeSelectionActionHost|PointerInteractionHost|dispatchPipeline)\b/;
        const offenders = readInputProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('does not clear passive range selection from unhandled pointerdown fallback', () => {
        const forbidden = /\b(?:clearPassiveSelectionForPointerDown|shouldClearPassiveSelectionOnPointerDown|shouldClearRangeSelectionOnPointerDown)\b/;
        const offenders = readInputProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });

    it('does not treat focusin as an implicit range-selection exit', () => {
        const offenders = readInputProductionFiles()
            .filter((file) => {
                const match = /private handleDocumentFocusIn[\s\S]*?\n    }\n/.exec(file.text);
                return !!match && /clearRangeSelection\s*\(/.test(match[0]);
            })
            .map((file) => file.rel);

        expect(offenders).toEqual([]);
    });
});
