import {
    IDLE_PIPELINE_STATE,
    reducePipeline,
    type DragDropSnapshot,
    type DropResolution,
    type PipelineEvent,
    type PipelineOutput,
    type PipelineState,
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
let pipelineState: PipelineState = IDLE_PIPELINE_STATE;

function dispatch(event: PipelineEvent<PlatformPreviewData>): void {
    const result = reducePipeline<PlatformPreviewData>(pipelineState, event);
    pipelineState = result.state;
    applyPipelineOutputs(result.outputs);
}

const firstDrop = resolveDropSnapshot(selection, 24);
dispatch({
    type: 'hold_start',
    sessionId: 's1',
    target: { selection, source: 'handle' },
    pointerType: 'mouse',
});
dispatch({
    type: 'hold_ready',
    sessionId: 's1',
    pointerType: 'mouse',
});
dispatch({
    type: 'drag_start',
    sessionId: 's1',
    pointerType: 'mouse',
    drop: firstDrop,
});

const nextDrop = resolveDropSnapshot(selection, 48);
dispatch({
    type: 'drag_over',
    sessionId: 's1',
    pointerType: 'mouse',
    drop: nextDrop,
});

dispatch({
    type: 'drop',
    sessionId: 's1',
    pointerType: 'mouse',
    resolution: resolveDropCommit(selection, nextDrop),
});

function applyPipelineOutputs(outputs: PipelineOutput<PlatformPreviewData>[]): void {
    for (const output of outputs) {
        switch (output.type) {
            case 'drag_over':
                renderDropIndicator(output.drop.previewData?.indicatorY ?? null);
                break;
            case 'command_ready':
                console.log('apply command in your editor', output.command);
                break;
            case 'cancelled':
            case 'dropped':
                renderDropIndicator(null);
                break;
            case 'lifecycle':
                console.log('drag lifecycle', output.event.type);
                break;
        }
    }
}

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
): DropResolution<PlatformPreviewData> {
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
