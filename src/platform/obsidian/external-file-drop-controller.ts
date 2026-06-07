import { Notice, normalizePath } from 'obsidian';
import type { TFile } from 'obsidian';
import type DragNDropPlugin from '../../plugin/main';
import { FILE_DROP_TARGET_CLASS } from '../../shared/dom-selectors';
import {
    getActiveBlockSelectionView,
} from '../codemirror/extension/active-drag-registry';
import { FileMoveApplier } from './file-move-applier';
import type { BlockSelection } from '../../domain/selection/block-selection';
import {
    PointerDragTargetClient,
    registerPointerDragTargetClient,
} from '../codemirror/input/pointer-drag-target-router';
import type { DragDropSnapshot } from '../../drag/drop/drag-drop-snapshot';

type FileDropTarget = {
    file: TFile;
    element: HTMLElement;
};

type MarkdownViewWithFile = {
    file?: TFile | null;
    containerEl?: HTMLElement;
    getViewType?: () => string;
};

const SIDEBAR_FILE_SELECTOR = '.nav-file-title[data-path]';
const INTERNAL_LINK_SELECTOR = 'a.internal-link, .internal-link[data-href], .cm-hmd-internal-link[data-href]';

export class ExternalFileDropController {
    private readonly fileMoveApplier: FileMoveApplier;
    private highlightedTarget: HTMLElement | null = null;

    private readonly pointerDragTargetClient: PointerDragTargetClient = {
        containsPoint: (clientX, clientY) => this.resolveDropTargetAtPoint(clientX, clientY) !== null,
        resolveDropSnapshotAtPoint: (clientX, clientY) => this.resolveDropSnapshotAtPoint(clientX, clientY),
        previewDropAtPoint: (clientX, clientY) => {
            const target = this.resolveDropTargetAtPoint(clientX, clientY);
            if (!target) {
                this.clearHighlight();
                return;
            }
            this.setHighlightedTarget(target.element);
        },
        hideDropIndicator: () => this.clearHighlight(),
        buildBlockCommandAtPoint: (source, clientX, clientY) => {
            const didCommit = this.commitDropAtPoint(source, clientX, clientY);
            return {
                drop: didCommit
                    ? { target: null, rejectReason: null }
                    : { target: null, rejectReason: 'no_target' },
                command: null,
                didCommit,
            };
        },
        applyBlockCommand: () => undefined,
    };

    constructor(private readonly plugin: DragNDropPlugin) {
        this.fileMoveApplier = new FileMoveApplier(plugin.app);
    }

    register(): void {
        const unregister = registerPointerDragTargetClient(this.pointerDragTargetClient);
        this.plugin.register(() => {
            unregister();
            this.clearHighlight();
        });
    }

    private resolveDropSnapshotAtPoint(clientX: number, clientY: number): DragDropSnapshot {
        return this.resolveDropTargetAtPoint(clientX, clientY)
            ? { target: null, rejectReason: null }
            : { target: null, rejectReason: 'no_target' };
    }

    private commitDropAtPoint(source: BlockSelection, clientX: number, clientY: number): boolean {
        const target = this.resolveDropTargetAtPoint(clientX, clientY);
        if (!target) {
            this.clearHighlight();
            return false;
        }

        this.clearHighlight();
        const sourceView = getActiveBlockSelectionView();
        if (!sourceView) {
            new Notice('Dragger could not find the dragged block.');
            return false;
        }

        void this.fileMoveApplier.applyFileMove({
            sourceView,
            selection: source,
            targetFile: target.file,
        }).then((result) => {
            if (!result.moved) {
                new Notice('Dragger could not move this block to the target note.');
            }
        }).catch((error) => {
            console.error('[Dragger] failed to move block to file target:', error);
            new Notice('Dragger could not move this block to the target note.');
        });
        return true;
    }

    private resolveDropTargetAtPoint(clientX: number, clientY: number): FileDropTarget | null {
        if (typeof document.elementFromPoint !== 'function') return null;
        const target = document.elementFromPoint(clientX, clientY);
        return this.resolveDropTargetFromElement(target instanceof HTMLElement ? target : null);
    }

    private resolveDropTargetFromElement(target: HTMLElement | null): FileDropTarget | null {
        if (!target) return null;

        if (!this.isFileDropEnabled()) return null;

        const sidebarFile = target.closest<HTMLElement>(SIDEBAR_FILE_SELECTOR);
        if (sidebarFile) {
            const file = this.resolveSidebarFileTarget(sidebarFile);
            if (file) return { file, element: sidebarFile };
        }

        const link = target.closest<HTMLElement>(INTERNAL_LINK_SELECTOR);
        if (!link) return null;

        const file = this.resolveInternalLinkTarget(link);
        if (!file) return null;
        return { file, element: link };
    }

    private resolveSidebarFileTarget(element: HTMLElement): TFile | null {
        const rawPath = element.getAttribute('data-path');
        if (!rawPath) return null;
        return this.resolveMarkdownFileByVaultPath(rawPath);
    }

    private resolveInternalLinkTarget(element: HTMLElement): TFile | null {
        const rawLinkpath = this.getInternalLinkPath(element);
        if (!rawLinkpath) return null;

        const contextPath = this.resolveLinkContextPath(element);
        if (rawLinkpath.startsWith('#')) {
            return contextPath ? this.resolveMarkdownFileByVaultPath(contextPath) : null;
        }

        const cleanLinkpath = stripSubpath(rawLinkpath);
        if (!cleanLinkpath) return null;
        const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanLinkpath, contextPath ?? '');
        if (isMarkdownFile(resolved)) return resolved;
        return this.resolveMarkdownFileByVaultPath(cleanLinkpath);
    }

    private getInternalLinkPath(element: HTMLElement): string | null {
        const rawDataHref = element.getAttribute('data-href');
        if (rawDataHref) return normalizeInternalLinkAttribute(rawDataHref);

        if (element instanceof HTMLAnchorElement) {
            const rawHref = element.getAttribute('href');
            if (rawHref) return normalizeInternalLinkAttribute(rawHref);
        }

        return null;
    }

    private resolveLinkContextPath(element: HTMLElement): string | null {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view as MarkdownViewWithFile;
            if (view.getViewType?.() !== 'markdown') continue;
            if (!view.containerEl?.contains(element)) continue;
            return view.file?.path ?? null;
        }

        const sourceView = getActiveBlockSelectionView();
        if (!sourceView) return null;
        for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view as MarkdownViewWithFile & {
                editor?: { cm?: unknown };
            };
            if (view.editor?.cm === sourceView) {
                return view.file?.path ?? null;
            }
        }
        return null;
    }

    private resolveMarkdownFileByVaultPath(path: string): TFile | null {
        const cleaned = stripSubpath(path);
        if (!cleaned) return null;
        const candidates = cleaned.endsWith('.md')
            ? [cleaned]
            : [cleaned, `${cleaned}.md`];

        for (const candidate of candidates) {
            const normalized = normalizePath(candidate);
            const file = this.plugin.app.vault.getFileByPath?.(normalized)
                ?? this.plugin.app.vault.getAbstractFileByPath(normalized);
            if (isMarkdownFile(file)) return file;
        }

        return null;
    }

    private isFileDropEnabled(): boolean {
        return this.plugin.settings.enableCrossFileDrag === true;
    }

    private setHighlightedTarget(element: HTMLElement): void {
        if (this.highlightedTarget === element) return;
        this.clearHighlight();
        this.highlightedTarget = element;
        element.classList.add(FILE_DROP_TARGET_CLASS);
    }

    private clearHighlight(): void {
        this.highlightedTarget?.classList.remove(FILE_DROP_TARGET_CLASS);
        this.highlightedTarget = null;
    }
}

function normalizeInternalLinkAttribute(value: string): string | null {
    let linkpath = safelyDecodeURIComponent(value.trim());
    if (!linkpath.length) return null;
    if (/^(https?|mailto):/i.test(linkpath)) return null;

    if (linkpath.startsWith('#')) {
        return linkpath;
    }

    if (linkpath.startsWith('/')) {
        linkpath = linkpath.slice(1);
    }

    const aliasIndex = linkpath.indexOf('|');
    if (aliasIndex >= 0) {
        linkpath = linkpath.slice(0, aliasIndex);
    }

    return linkpath.trim() || null;
}

function stripSubpath(path: string): string {
    const hashIndex = path.indexOf('#');
    return (hashIndex >= 0 ? path.slice(0, hashIndex) : path).trim();
}

function safelyDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function isMarkdownFile(file: unknown): file is TFile {
    const candidate = file as TFile | null;
    return !!candidate
        && typeof candidate.path === 'string'
        && candidate.extension === 'md';
}
