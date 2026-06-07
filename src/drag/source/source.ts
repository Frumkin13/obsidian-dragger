import type { BlockInfo } from '../../domain/block/block-types';
import type { DragSource, DragSourceRange } from '../../shared/types/drag';

export type { DragSource, DragSourceRange };

export function createDragSource(primaryBlock: BlockInfo, ranges: DragSourceRange[]): DragSource {
    return { primaryBlock, ranges };
}
