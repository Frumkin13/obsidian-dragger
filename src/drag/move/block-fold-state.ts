import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { getHeadingLevel } from '../../domain/block/block-detector';
import { BlockType, type BlockInfo } from '../../domain/block/block-types';
import type { ParsedLine } from '../../shared/types/protocol-types';
import { isEditorLineCollapsed, toggleLineFolds } from '../../platform/obsidian/editor-fold';

export interface CapturedBlockFoldState {
    collapsedRelativeLineOffsets: number[];
}

export interface BlockFoldStateManager {
    capture(view: EditorView, sourceBlock: BlockInfo): CapturedBlockFoldState | null;
    restore(view: EditorView, targetStartLineNumber: number, foldState: CapturedBlockFoldState | null): void;
}

export function createBlockFoldStateManager(params: {
    app: App;
    parseLineWithQuote: (line: string) => ParsedLine;
}): BlockFoldStateManager {
    const { app, parseLineWithQuote } = params;

    return {
        capture(view, sourceBlock) {
            if (!isBlockFoldStateSupported(sourceBlock)) return null;
            if ((sourceBlock.compositeSelection?.ranges?.length ?? 0) > 1) return null;

            const startLineNumber = sourceBlock.startLine + 1;
            const endLineNumber = sourceBlock.endLine + 1;
            const collapsedRelativeLineOffsets: number[] = [];

            for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
                const lineText = view.state.doc.line(lineNumber).text;
                if (!isFoldableLineWithinBlock(sourceBlock, lineText, parseLineWithQuote)) continue;
                if (!isEditorLineCollapsed(view, lineNumber)) continue;
                collapsedRelativeLineOffsets.push(lineNumber - startLineNumber);
            }

            if (collapsedRelativeLineOffsets.length === 0) return null;
            return { collapsedRelativeLineOffsets };
        },
        restore(view, targetStartLineNumber, foldState) {
            const collapsedRelativeLineOffsets = foldState?.collapsedRelativeLineOffsets ?? [];
            if (collapsedRelativeLineOffsets.length === 0) return;

            toggleLineFolds({
                app,
                view,
                targetLineNumbers: collapsedRelativeLineOffsets.map(
                    (relativeOffset) => targetStartLineNumber + relativeOffset
                ),
            });
        },
    };
}

function isBlockFoldStateSupported(sourceBlock: BlockInfo): boolean {
    return sourceBlock.type === BlockType.ListItem || sourceBlock.type === BlockType.Heading;
}

function isFoldableLineWithinBlock(
    sourceBlock: BlockInfo,
    lineText: string,
    parseLineWithQuote: (line: string) => ParsedLine
): boolean {
    if (sourceBlock.type === BlockType.ListItem) {
        return parseLineWithQuote(lineText).isListItem;
    }
    if (sourceBlock.type === BlockType.Heading) {
        return getHeadingLevel(lineText) !== null;
    }
    return false;
}
