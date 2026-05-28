import { EditorState } from '@codemirror/state';
import { BlockInfo } from '../../domain/block/block-types';
import { detectBlock } from '../../domain/block/block-detector';

export function resolveHandleBlockAtLine(state: EditorState, lineNumber: number): BlockInfo | null {
    const block = detectBlock(state, lineNumber);
    if (!block) return null;
    if (block.startLine + 1 !== lineNumber) return null;
    return block;
}
