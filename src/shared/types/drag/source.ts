import type { BlockInfo } from '../../../domain/block/block-types';

export type DragSourceRange = {
    startLine: number;
    endLine: number;
};

export type DragSource = {
    primaryBlock: BlockInfo;
    ranges: DragSourceRange[];
};
