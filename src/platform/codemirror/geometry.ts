import { EditorView } from '@codemirror/view';
import { detectBlock } from '../../domain/block/block-detector';
import { BlockType } from '../../domain/block/block-types';
import {
    getCoordsAtPos as getCoordsAtPosCached,
    getLineRect as getLineRectByLineNumber,
    getInsertionAnchorY as getInsertionAnchorYByLineNumber,
    getLineIndentPosByWidth as getLineIndentPosByWidthWithTabSize,
    getBlockRect as getBlockRectByRange,
} from './rect-calculator';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import { LineParsingContext } from '../../domain/markdown/line-parsing-service';
import { isEditorLineCollapsed } from '../../platform/obsidian/editor-fold';

export class GeometryCalculator {
    constructor(
        private readonly view: EditorView,
        private readonly lineParsing: LineParsingContext
    ) { }

    getAdjustedTargetLocation(
        lineNumber: number,
        options?: { clientY?: number }
    ): { lineNumber: number; blockAdjusted: boolean } {
        const doc = this.view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) {
            return { lineNumber: clampTargetLineNumber(doc.lines, lineNumber), blockAdjusted: false };
        }

        const block = detectBlock(this.view.state, lineNumber);
        if (!block) return { lineNumber, blockAdjusted: false };

        const isAtomicBlock = block.type === BlockType.CodeBlock
            || block.type === BlockType.Table
            || block.type === BlockType.MathBlock;
        const isCollapsedBlock = (block.startLine !== block.endLine)
            && isEditorLineCollapsed(this.view, block.startLine + 1);

        if (!isAtomicBlock && !isCollapsedBlock) {
            return { lineNumber, blockAdjusted: false };
        }

        if (typeof options?.clientY === 'number') {
            const blockStartLine = doc.line(block.startLine + 1);
            const blockEndLine = doc.line(block.endLine + 1);
            const startCoords = getCoordsAtPosCached(this.view, blockStartLine.from);
            const endCoords = getCoordsAtPosCached(this.view, blockEndLine.to);
            if (startCoords && endCoords) {
                const midPoint = (startCoords.top + endCoords.bottom) / 2;
                const insertAfter = options.clientY > midPoint;
                const adjustedLineNumber = insertAfter ? block.endLine + 2 : block.startLine + 1;
                return {
                    lineNumber: clampTargetLineNumber(doc.lines, adjustedLineNumber),
                    blockAdjusted: true,
                };
            }
        }

        const lineIndex = lineNumber - 1;
        const midLine = (block.startLine + block.endLine) / 2;
        const adjustedLineNumber = lineIndex <= midLine ? block.startLine + 1 : block.endLine + 2;
        return {
            lineNumber: clampTargetLineNumber(doc.lines, adjustedLineNumber),
            blockAdjusted: true,
        };
    }

    getLineRect(lineNumber: number): { left: number; width: number } | undefined {
        return getLineRectByLineNumber(this.view, lineNumber);
    }

    getInsertionAnchorY(lineNumber: number): number | null {
        return getInsertionAnchorYByLineNumber(this.view, lineNumber);
    }

    getLineIndentPosByWidth(lineNumber: number, targetIndentWidth: number): number | null {
        return getLineIndentPosByWidthWithTabSize(
            this.view,
            lineNumber,
            targetIndentWidth,
            this.lineParsing.getTabSize()
        );
    }

    getBlockRect(
        startLineNumber: number,
        endLineNumber: number
    ): { top: number; left: number; width: number; height: number } | undefined {
        return getBlockRectByRange(this.view, startLineNumber, endLineNumber);
    }
}


