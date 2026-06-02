import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DocLike, ParsedLine } from '../../shared/types/protocol-types';
import {
    buildIndentStringFromSample,
    getIndentUnitWidth,
    getIndentUnitWidthForDoc,
    normalizeTabSize,
    parseLineWithQuote,
} from './indent-calculator';

export interface LineParsingContext {
    getTabSize: () => number;
    parseLine: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
}

export function createLineParsingContext(view: EditorView): LineParsingContext {
    const getTabSize = () => normalizeTabSize(view.state.facet(EditorState.tabSize));
    const parseLine = (line: string) => parseLineWithQuote(line, getTabSize());
    return {
        getTabSize,
        parseLine,
        getIndentUnitWidth: (sample: string) => getIndentUnitWidth(sample, getTabSize()),
        getIndentUnitWidthForDoc: (doc: DocLike) => getIndentUnitWidthForDoc(doc, parseLine, getTabSize()),
        buildIndentStringFromSample: (sample: string, width: number) => buildIndentStringFromSample(sample, width, getTabSize()),
    };
}
