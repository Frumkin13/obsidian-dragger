import { Notice, normalizePath } from 'obsidian';
import type { TFile } from 'obsidian';
import type DragNDropPlugin from '../../plugin/main';
import { FILE_DROP_TARGET_CLASS } from '../../shared/dom-selectors';
import { DND_BLOCK_TRANSFER_MIME_TYPE } from '../../shared/drag';
import {
    getActiveDragSourceBlock,
    getActiveDragSourceView,
} from '../state/drag-session';
import {
    finishDragSession,
    getDragSourceBlockFromEvent,
} from '../ui/indicator/ghost-element';
import { FileBlockMover } from '../mutation/file-block-mover';

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
    private readonly fileBlockMover: FileBlockMover;
    private highlightedTarget: HTMLElement | null = null;

    constructor(private readonly plugin: DragNDropPlugin) {
        this.fileBlockMover = new FileBlockMover(plugin.app);
    }

    register(): void {
        this.plugin.registerDomEvent(document, 'dragover', this.onDragOver, true);
        this.plugin.registerDomEvent(document, 'dragleave', this.onDragLeave, true);
        this.plugin.registerDomEvent(document, 'drop', this.onDrop, true);
        this.plugin.registerDomEvent(document, 'dragend', this.onDragEnd, true);
    }

    private readonly onDragOver = (event: DragEvent): void => {
        const target = this.resolveDropTarget(event);
        if (!target) {
            this.clearHighlight();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        this.setHighlightedTarget(target.element);
    };

    private readonly onDragLeave = (event: DragEvent): void => {
        if (!this.highlightedTarget) return;
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (nextTarget && this.highlightedTarget.contains(nextTarget)) return;
        this.clearHighlight();
    };

    private readonly onDrop = (event: DragEvent): void => {
        const target = this.resolveDropTarget(event);
        if (!target) {
            this.clearHighlight();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.clearHighlight();

        const sourceView = getActiveDragSourceView();
        const sourceBlock = this.getSourceBlock(event);
        if (!sourceView || !sourceBlock) {
            finishDragSession();
            new Notice('Dragger could not find the dragged block.');
            return;
        }

        void this.fileBlockMover.moveBlockToFile({
            sourceView,
            sourceBlock,
            targetFile: target.file,
        }).then((result) => {
            if (!result.moved) {
                new Notice('Dragger could not move this block to the target note.');
            }
        }).catch((error) => {
            console.error('[Dragger] failed to move block to file target:', error);
            new Notice('Dragger could not move this block to the target note.');
        }).finally(() => {
            finishDragSession();
        });
    };

    private readonly onDragEnd = (): void => {
        this.clearHighlight();
    };

    private resolveDropTarget(event: DragEvent): FileDropTarget | null {
        if (!this.isFileDropEnabled()) return null;
        if (!hasBlockTransfer(event)) return null;
        const sourceView = getActiveDragSourceView();
        if (!sourceView || !getActiveDragSourceBlock(sourceView)) return null;

        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return null;

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

        const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(rawLinkpath, contextPath ?? '');
        if (isMarkdownFile(resolved)) return resolved;
        return this.resolveMarkdownFileByVaultPath(stripSubpath(rawLinkpath));
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

        const sourceView = getActiveDragSourceView();
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
            const file = this.plugin.app.vault.getFileByPath(normalized)
                ?? this.plugin.app.vault.getAbstractFileByPath(normalized);
            if (isMarkdownFile(file)) return file;
        }

        return null;
    }

    private isFileDropEnabled(): boolean {
        return this.plugin.settings.enableCrossFileDrag === true;
    }

    private getSourceBlock(event: DragEvent) {
        try {
            return getDragSourceBlockFromEvent(event);
        } catch {
            const sourceView = getActiveDragSourceView();
            return sourceView ? getActiveDragSourceBlock(sourceView) : null;
        }
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

function hasBlockTransfer(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes(DND_BLOCK_TRANSFER_MIME_TYPE);
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
