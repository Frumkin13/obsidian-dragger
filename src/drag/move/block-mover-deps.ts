import { EditorView } from '@codemirror/view';
import { InsertionSlotContext } from '../../domain/rules/insertion-rules';
import { LineMap } from '../../domain/markdown/line-map';
import { BlockInfo } from '../../domain/block/block-types';
import { DocLike, DropPlan, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { BlockFoldStateManager } from './block-fold-state';

export interface BlockMoverDeps {
    view: EditorView;
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
        listIntent?: DropPlan['listIntent']
    ) => string;
    blockFoldState?: BlockFoldStateManager;
}
