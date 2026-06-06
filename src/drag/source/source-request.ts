import type { Text } from '@codemirror/state';
import type { BlockInfo } from '../../domain/block/block-types';
import type { SelectedBlockRange } from './selected-blocks';

export type DragSourceRequest =
    | { kind: 'handle'; handle: HTMLElement }
    | { kind: 'point'; clientX: number; clientY: number }
    | { kind: 'block'; block: BlockInfo }
    | {
        kind: 'selection';
        doc: Text;
        blocks: SelectedBlockRange[];
        templateBlock: BlockInfo;
    };
