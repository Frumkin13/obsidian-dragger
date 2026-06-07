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
    it('keeps drag top-level folders aligned with PRD stages', () => {
        const topLevelDirs = readdirSync(dragRoot)
            .filter((entry) => statSync(join(dragRoot, entry)).isDirectory())
            .sort();
        expect(topLevelDirs).toEqual([
            'cleanup',
            'drop',
            'input',
            'intent',
            'move',
            'pipeline',
            'preview',
            'source',
            'state',
        ]);
    });

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

    it('keeps state as pure interaction state without DOM, timers, rendering, or document mutation', () => {
        const forbidden = /\b(?:document|window)\.|\b(?:PointerEvent|MouseEvent|KeyboardEvent|FocusEvent|TouchEvent|HTMLElement|DOMRect)\b|\bEditorView\b|view\.dispatch|\.dispatch\(|rangeVisual|\.render\(|getBoundingClientRect|querySelector|classList|addEventListener|removeEventListener|setTimeout|clearTimeout|requestAnimationFrame|cancelAnimationFrame/;
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/state/'))
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('keeps state from importing business stages or platform/input/preview/pipeline helpers', () => {
        const forbiddenImport = /from ['"](?:\.\.\/)*(?:input|preview|pipeline|move|drop|cleanup|platform|runtime)\//;
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/state/'))
            .filter((file) => forbiddenImport.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('keeps pipeline as orchestration files instead of lifecycle/mobile business buckets', () => {
        const pipelineFiles = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/pipeline/'))
            .map((file) => file.rel.replace('src/drag/pipeline/', ''))
            .sort();
        expect(pipelineFiles).toEqual([
            'drag-controller.ts',
            'drop-commit-pipeline.ts',
            'pointer-selecting-actions.ts',
            'pointerdown-pipeline.ts',
            'pointermove-pipeline.ts',
            'pointerup-pipeline.ts',
            'touch-selecting-actions.ts',
        ]);

        const forbiddenNames = pipelineFiles.filter((file) => (
            /gesture|orchestrator|lifecycle|mobile-selection|touch-selection|range-selection|desktop-pointerdown|drag-intent-executor/.test(file)
        ));
        expect(forbiddenNames).toEqual([]);
    });
});
