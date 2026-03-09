import { EditorView } from '@codemirror/view';
import { InsertionSlotContext } from '../../core/container-rules/insertion-rules';
import { LineMap } from '../../core/parser/line-map';
import { BlockInfo } from '../../core/block/block-types';
import { DocLike, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { BlockFoldStateManager } from './block-fold-state';

export interface BlockMoverDeps {
    view: EditorView;
    getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) => { lineNumber: number; blockAdjusted: boolean };
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: LineMap }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: string | null };
    };
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    buildInsertText: (
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ) => string;
    blockFoldState?: BlockFoldStateManager;
}
