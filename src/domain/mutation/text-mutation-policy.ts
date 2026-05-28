import { BlockInfo } from '../block/block-types';
import {
    adjustListToTargetContext,
    buildInsertText as buildInsertTextByPolicy,
    getListContext,
} from './structure-mutation';
import { DocLike, ListContext, ListDropIntent, ParsedLine } from '../../shared/types/protocol-types';
import { LineParsingService } from '../markdown/line-parsing-service';

export class TextMutationPolicy {
    constructor(
        private readonly lineParsingService: LineParsingService
    ) { }

    parseLineWithQuote(line: string): ParsedLine {
        return this.lineParsingService.parseLine(line);
    }

    getListContext(doc: DocLike, lineNumber: number): ListContext {
        return getListContext(doc, lineNumber, (line) => this.parseLineWithQuote(line));
    }

    getIndentUnitWidth(sample: string): number {
        return this.lineParsingService.getIndentUnitWidth(sample);
    }

    getIndentUnitWidthForDoc(doc: DocLike): number {
        return this.lineParsingService.getIndentUnitWidthForDoc(doc);
    }

    buildInsertText(
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listIntent?: ListDropIntent
    ): string {
        return buildInsertTextByPolicy({
            sourceBlockType: sourceBlock.type,
            sourceContent,
            adjustListToTargetContext: (content) => adjustListToTargetContext({
                doc,
                sourceContent: content,
                targetLineNumber,
                parseLineWithQuote: (line) => this.parseLineWithQuote(line),
                getIndentUnitWidth: (sample) => this.getIndentUnitWidth(sample),
                buildIndentStringFromSample: (sample, width) =>
                    this.lineParsingService.buildIndentStringFromSample(sample, width),
                buildTargetMarker: (_target, source) => source.marker,
                markerConversionScope: 'none',
                getListContext: (activeDoc, lineNumber) => this.getListContext(activeDoc, lineNumber),
                listIntent,
            }),
        });
    }
}


