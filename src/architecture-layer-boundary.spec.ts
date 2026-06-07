import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(process.cwd(), 'src');

type SourceFile = {
    rel: string;
    text: string;
};

type ImportEdge = {
    rel: string;
    specifier: string;
    resolved: string | null;
};

function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectTsFiles(path));
            continue;
        }
        if (
            entry.endsWith('.ts')
            && !entry.endsWith('.spec.ts')
            && !entry.endsWith('.test-helpers.ts')
            && entry !== 'test-setup.ts'
        ) {
            files.push(path);
        }
    }
    return files;
}

function readProductionFiles(): SourceFile[] {
    return collectTsFiles(srcRoot).map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

function extractImportSpecifiers(text: string): string[] {
    const specifiers = new Set<string>();
    const fromRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    const sideEffectRe = /^\s*import\s+['"]([^'"]+)['"]/gm;
    for (const match of text.matchAll(fromRe)) {
        specifiers.add(match[1]);
    }
    for (const match of text.matchAll(sideEffectRe)) {
        specifiers.add(match[1]);
    }
    return Array.from(specifiers);
}

function resolveImport(rel: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const resolved = join(dirname(rel), specifier).replace(/\\/g, '/');
    return resolved.replace(/\/index$/, '').replace(/\.ts$/, '');
}

function collectImportEdges(): ImportEdge[] {
    return readProductionFiles().flatMap((file) => (
        extractImportSpecifiers(file.text).map((specifier) => ({
            rel: file.rel,
            specifier,
            resolved: resolveImport(file.rel, specifier),
        }))
    ));
}

function edgeKey(edge: ImportEdge): string {
    return `${edge.rel} -> ${edge.specifier}`;
}

function sortedUnique(values: string[]): string[] {
    return Array.from(new Set(values)).sort();
}

function isLayerImport(edge: ImportEdge, layer: 'domain' | 'drag' | 'platform' | 'plugin' | 'runtime'): boolean {
    return edge.resolved?.startsWith(`src/${layer}/`) ?? false;
}

function isCodeMirrorViewImport(edge: ImportEdge): boolean {
    return edge.specifier === '@codemirror/view';
}

function isCodeMirrorStateImport(edge: ImportEdge): boolean {
    return edge.specifier === '@codemirror/state';
}

const knownDomainBoundaryViolations = new Set([
    'src/domain/block/block-detector.ts -> @codemirror/state',
    'src/domain/markdown/fence-scanner.ts -> @codemirror/state',
    'src/domain/markdown/line-map.ts -> @codemirror/state',
    'src/domain/markdown/line-parsing-service.ts -> @codemirror/state',
    'src/domain/markdown/line-parsing-service.ts -> @codemirror/view',
    'src/domain/rules/container-policy-service.ts -> @codemirror/view',
]);

const knownDragBoundaryViolations = new Set([
    'src/drag/drop/drop-planner.ts -> @codemirror/view',
    'src/drag/drop/drop-planner.ts -> ../../platform/codemirror/rect-calculator',
    'src/drag/drop/drop-planner.ts -> ../../platform/dom/embed-probe',
    'src/drag/drop/drop-planner.ts -> ../../platform/dom/element-probe',
    'src/drag/drop/drop-planner.ts -> ../../platform/dom/line-hit',
    'src/drag/drop/drop-planner.ts -> ../../platform/dom/table-guard',
    'src/drag/drop/list-drop-planner.ts -> @codemirror/view',
    'src/drag/drop/list-drop-planner.ts -> ../../platform/codemirror/rect-calculator',
    'src/drag/input/drag-input.ts -> @codemirror/view',
    'src/drag/input/pointer-session-controller.ts -> @codemirror/view',
    'src/drag/input/touch-interaction-controller.ts -> @codemirror/view',
    'src/drag/input/touch-interaction-controller.ts -> ../../platform/dom/element-probe',
    'src/drag/input/touch-interaction-controller.ts -> ../../platform/dom/embed-probe',
    'src/drag/move/block-fold-state.ts -> @codemirror/view',
    'src/drag/move/block-fold-state.ts -> obsidian',
    'src/drag/move/block-fold-state.ts -> ../../platform/obsidian/editor-fold',
    'src/drag/move/block-mover.ts -> @codemirror/view',
    'src/drag/move/block-mover.ts -> ../../platform/codemirror/undo-selection-anchor',
    'src/drag/move/file-mover.ts -> @codemirror/view',
    'src/drag/move/file-mover.ts -> obsidian',
    'src/drag/move/file-mover.ts -> ../../platform/codemirror/undo-selection-anchor',
    'src/drag/move/file-mover.ts -> ../../platform/obsidian/editor-view',
    'src/drag/pipeline/drag-controller.ts -> @codemirror/view',
    'src/drag/pipeline/pointer-selecting-actions.ts -> @codemirror/view',
    'src/drag/pipeline/pointerdown-pipeline.ts -> @codemirror/view',
    'src/drag/pipeline/touch-selecting-actions.ts -> @codemirror/view',
    'src/drag/pipeline/touch-selecting-actions.ts -> ../../platform/dom/element-probe',
    'src/drag/preview/drop-indicator.ts -> @codemirror/view',
    'src/drag/preview/handle-renderer.ts -> @codemirror/view',
    'src/drag/preview/handle-visibility-controller.ts -> @codemirror/view',
    'src/drag/preview/handle-visibility-controller.ts -> ../../platform/dom/embed-probe',
    'src/drag/preview/handle-visibility-controller.ts -> ../../platform/dom/element-probe',
    'src/drag/preview/handle-visibility-controller.ts -> ../../platform/dom/line-dom',
    'src/drag/preview/range-selection-visual-manager.ts -> @codemirror/view',
    'src/drag/preview/range-selection-visual-manager.ts -> ../../platform/dom/element-probe',
    'src/drag/source/source.ts -> @codemirror/view',
    'src/drag/source/source.ts -> ../../platform/dom/embed-probe',
    'src/drag/source/source.ts -> ../../platform/dom/element-probe',
    'src/drag/source/source.ts -> ../../platform/dom/line-hit',
    'src/drag/source/source.ts -> ../../platform/obsidian/editor-fold',
]);

const knownDragDispatchViolations = new Set([
    'src/drag/move/block-mover.ts',
    'src/drag/move/file-mover.ts',
    'src/drag/pipeline/drag-controller.ts',
]);

const knownSharedBusinessTypeFiles = new Set([
    'src/shared/types/drag/context.ts',
    'src/shared/types/drag/events.ts',
    'src/shared/types/drag/index.ts',
    'src/shared/types/drag/range-selection.ts',
    'src/shared/types/drag/source.ts',
    'src/shared/types/settings-types.ts',
    'src/shared/utils/block-ranges.ts',
    'src/shared/utils/composite-selection.ts',
]);

describe('minimal block command architecture boundaries', () => {
    it('prevents new domain dependencies on host, platform, drag, runtime, or plugin layers', () => {
        const offenders = collectImportEdges()
            .filter((edge) => edge.rel.startsWith('src/domain/'))
            .filter((edge) => (
                edge.specifier === 'obsidian'
                || isCodeMirrorViewImport(edge)
                || isCodeMirrorStateImport(edge)
                || isLayerImport(edge, 'drag')
                || isLayerImport(edge, 'platform')
                || isLayerImport(edge, 'runtime')
                || isLayerImport(edge, 'plugin')
            ))
            .map(edgeKey)
            .filter((key) => !knownDomainBoundaryViolations.has(key));

        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('prevents new drag dependencies on platform implementations, plugin, Obsidian, or CodeMirror view', () => {
        const offenders = collectImportEdges()
            .filter((edge) => edge.rel.startsWith('src/drag/'))
            .filter((edge) => (
                edge.specifier === 'obsidian'
                || isCodeMirrorViewImport(edge)
                || isLayerImport(edge, 'platform')
                || isLayerImport(edge, 'runtime')
                || isLayerImport(edge, 'plugin')
            ))
            .map(edgeKey)
            .filter((key) => !knownDragBoundaryViolations.has(key));

        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('keeps platform independent from drag internals, plugin, and runtime', () => {
        const offenders = collectImportEdges()
            .filter((edge) => edge.rel.startsWith('src/platform/'))
            .filter((edge) => (
                isLayerImport(edge, 'plugin')
                || isLayerImport(edge, 'runtime')
                || edge.resolved?.startsWith('src/drag/pipeline/')
                || edge.resolved?.startsWith('src/drag/state/')
                || edge.resolved?.startsWith('src/drag/move/')
                || edge.resolved?.startsWith('src/drag/drop/')
            ))
            .map(edgeKey);

        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('prevents new drag-side transaction execution', () => {
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/'))
            .filter((file) => /\b(?:this\.)?view\.dispatch\s*\(/.test(file.text))
            .map((file) => file.rel)
            .filter((rel) => !knownDragDispatchViolations.has(rel));

        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('prevents new shared business model files', () => {
        const businessTypePattern = /\b(?:BlockSelection|BlockCommand|DropTarget|BlockTransaction|DragSource|DragLifecycle|RangeSelection|CompositeLineRange)\b/;
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/shared/'))
            .filter((file) => businessTypePattern.test(file.text))
            .map((file) => file.rel)
            .filter((rel) => !knownSharedBusinessTypeFiles.has(rel));

        expect(sortedUnique(offenders)).toEqual([]);
    });
});
