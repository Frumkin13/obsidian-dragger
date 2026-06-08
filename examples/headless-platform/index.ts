import {
    DragFlowController,
    executeDragEffects,
    type DragEffectExecutor,
    type DragDropSnapshot,
    type DropCommitResolution,
} from 'dragger/drag';
import {
    BlockType,
    createMoveCommand,
    createSingleBlockSelection,
    type BlockSelection,
} from 'dragger/domain';

type PlatformPreviewData = {
    indicatorY: number;
};

const block = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

const selection = createSingleBlockSelection(block);
const drag = new DragFlowController<PlatformPreviewData>();

const effects: DragEffectExecutor<PlatformPreviewData> = {
    showDropPreview: (_selection, drop) => {
        renderDropIndicator(drop.previewData?.indicatorY ?? null);
    },
    hideDropPreview: () => renderDropIndicator(null),
    applyCommand: (command) => {
        console.log('apply command in your editor', command);
    },
    emitLifecycle: (event) => {
        console.log('drag lifecycle', event.type);
    },
};

const firstDrop = resolveDropSnapshot(selection, 24);
executeDragEffects(effects, drag.begin({
    selection,
    pointerId: 1,
    pointerType: 'mouse',
    drop: firstDrop,
}).effects);

const nextDrop = resolveDropSnapshot(selection, 48);
executeDragEffects(effects, drag.preview({
    pointerId: 1,
    pointerType: 'mouse',
    drop: nextDrop,
}));

executeDragEffects(effects, drag.commit({
    pointerId: 1,
    pointerType: 'mouse',
    resolution: resolveDropCommit(selection, nextDrop),
}));

function resolveDropSnapshot(
    _selection: BlockSelection,
    indicatorY: number
): DragDropSnapshot<PlatformPreviewData> {
    return {
        target: {
            targetLineNumber: Math.max(1, Math.round(indicatorY / 24)),
            placement: 'before',
        },
        rejectReason: null,
        previewData: { indicatorY },
    };
}

function resolveDropCommit(
    selection: BlockSelection,
    drop: DragDropSnapshot<PlatformPreviewData>
): DropCommitResolution<PlatformPreviewData> {
    if (!drop.target) {
        return { type: 'cancel', drop, reason: drop.rejectReason ?? 'no_target' };
    }
    return {
        type: 'command',
        command: createMoveCommand(selection, drop.target),
        drop,
    };
}

function renderDropIndicator(indicatorY: number | null): void {
    console.log('render drop indicator', indicatorY);
}
