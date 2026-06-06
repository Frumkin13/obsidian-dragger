import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const dragRoot = join(process.cwd(), 'src', 'drag');

function collectTsFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectTsFiles(path));
            continue;
        }
        if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test-helpers.ts')) {
            files.push(path);
        }
    }
    return files;
}

function readProductionFiles(): Array<{ path: string; rel: string; text: string }> {
    return collectTsFiles(dragRoot).map((path) => ({
        path,
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

describe('drag architecture boundaries', () => {
    it('keeps DragSource construction inside source stage', () => {
        const offenders = readProductionFiles()
            .filter((file) => !file.rel.startsWith('src/drag/source/'))
            .filter((file) => /\bcreateDragSource\s*\(/.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('keeps intent pure and free of state/source/drop side effects', () => {
        const forbidden = /createDragSource|beginPressPendingDrag|enterDraggingState|beginRangeSelectionSession|performDropAtPoint|host\.|gesture\s*=/;
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/intent/'))
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('keeps preview independent from drop planner implementation', () => {
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/preview/'))
            .filter((file) => /drop-planner|DropPlanner|resolveValidatedDropTarget/.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('does not keep legacy source models or handle-to-point fallback paths', () => {
        const forbidden = /compositeSelection|DragSourceSelection|getActiveDragSourceBlock|fromBlockInfo|toLegacyBlockInfo|sourceBlock\.compositeSelection|drag\/gesture|range_selecting|mobile_selecting|resolveInteractionBlockInfo|getBlockInfoForHandle\([^\n]*\)\s*\?\?|buildDragSourceFromBlocks|buildDragSourceFromBlock|cloneDragSource|cloneCommittedSelectionSource|activeSelectionSource|directDragSource|anchorSelectionSource/;
        const offenders = readProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });
});
