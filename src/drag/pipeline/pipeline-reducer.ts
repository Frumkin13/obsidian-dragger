import type { PipelineEvent } from './pipeline-event';
import {
    buildIdleLifecycleEvent,
    buildPressPendingLifecycleEvent,
    type PipelineOutput,
} from './pipeline-output';
import type { BlockSelection } from '../../domain/selection/block-selection';
import {
    createBlockRangeResizeSelectionState,
    createBlockRangeSelectionState,
    updateBlockRangeSelectionState,
    type BlockRangeSelectionState,
} from '../selection/block-range-selection';
import { drop, dragOver, startDragDrop } from './pipeline-drop';
import { clearSelection, cancelPipeline, destroyPipeline, exitForUnavailableGuard } from './pipeline-exit';
import { withGuardDeps } from './pipeline-guard';
import { IDLE_PIPELINE_STATE, type PipelineState } from './pipeline-state';

export type PipelineReduceResult<TPreview = unknown> = {
    state: PipelineState;
    outputs: PipelineOutput<TPreview>[];
};

export function reducePipeline<TPreview>(
    state: PipelineState,
    event: PipelineEvent<TPreview>
): PipelineReduceResult<TPreview> {
    switch (event.type) {
        case 'hold_start':
            return enterHolding(state, event);
        case 'hold_ready':
            return markHoldReady(state, event);
        case 'selection_start':
            return enterSelecting(state, event);
        case 'selection_change':
            return updateSelecting(state, event);
        case 'selection_finish':
            return finishSelecting(state);
        case 'selection_clear':
            return clearSelection(state);
        case 'drag_start':
            return startDragging(state, event);
        case 'drag_over':
            return updateDragging(state, event);
        case 'drop':
            return dropDragging(state, event);
        case 'cancel':
            return cancelPipeline(state, event.reason, event.pointerType ?? null);
        case 'guard_unavailable':
            return exitForUnavailableGuard(state, event.guardId);
        case 'destroy':
            return destroyPipeline();
    }
}

function enterHolding<TPreview>(
    _state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_start' }>
): PipelineReduceResult<TPreview> {
    const next: PipelineState = {
        type: 'holding',
        hold: {
            sessionId: event.sessionId,
            target: event.target,
            guardDeps: withGuardDeps(event.guardDeps),
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'lifecycle', event: buildPressPendingLifecycleEvent(event.target.selection, event.pointerType ?? null, false) },
        ],
    };
}

function markHoldReady<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_ready' }>
): PipelineReduceResult<TPreview> {
    if (state.type !== 'holding' || state.hold.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'ready_to_drag',
        hold: state.hold,
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'lifecycle', event: buildPressPendingLifecycleEvent(state.hold.target.selection, event.pointerType ?? null, true) },
        ],
    };
}

function enterSelecting<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_start' }>
): PipelineReduceResult<TPreview> {
    const rangeState = createSelectionRangeState(event.seed);
    if (event.seed.range && !rangeState) {
        return { state, outputs: [] };
    }
    const selectionRangeState = rangeState ?? undefined;
    const selection = rangeState
        ? buildSelectionFromRangeState(event.seed.selection, rangeState.selectionBlocks)
        : event.seed.selection;
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            selection,
            phase: 'adjusting',
            guardDeps: withGuardDeps(event.guardDeps),
            rangeState: selectionRangeState,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection },
        ],
    };
}

function createSelectionRangeState(
    seed: Extract<PipelineEvent, { type: 'selection_start' }>['seed']
): BlockRangeSelectionState | null | undefined {
    if (!seed.range) return undefined;
    if (seed.range.type === 'resize') {
        return createBlockRangeResizeSelectionState(seed.range);
    }
    return createBlockRangeSelectionState(seed.range);
}

function updateSelecting<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_change' }>
): PipelineReduceResult<TPreview> {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    if (!state.selection.rangeState || event.docLines === undefined || !event.resolveBoundary) {
        return { state, outputs: [] };
    }

    const rangeState = updateBlockRangeSelectionState(state.selection.rangeState, {
        docLines: event.docLines,
        target: event.boundary,
        resolveBoundary: event.resolveBoundary,
    });
    const selection = buildSelectionFromRangeState(state.selection.selection, rangeState.selectionBlocks);
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            ...state.selection,
            selection,
            phase: 'adjusting',
            rangeState,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection },
        ],
    };
}

function buildSelectionFromRangeState(
    base: BlockSelection,
    blocks: Array<{ startLineNumber: number; endLineNumber: number }>
): BlockSelection {
    return {
        ...base,
        ranges: blocks.map((block) => ({
            startLine: block.startLineNumber - 1,
            endLine: block.endLineNumber - 1,
        })),
    };
}

function finishSelecting<TPreview>(state: PipelineState): PipelineReduceResult<TPreview> {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            ...state.selection,
            phase: 'passive',
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection: next.selection.selection },
        ],
    };
}

function startDragging<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_start' }>
): PipelineReduceResult<TPreview> {
    if (state.type !== 'ready_to_drag' || state.hold.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            sessionId: event.sessionId,
            selection: state.hold.target.selection,
            drop: event.drop,
            guardDeps: state.hold.guardDeps,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...startDragDrop({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function updateDragging<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_over' }>
): PipelineReduceResult<TPreview> {
    if (state.type !== 'dragging' || state.drag.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            ...state.drag,
            drop: event.drop,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...dragOver({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function dropDragging<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drop' }>
): PipelineReduceResult<TPreview> {
    if (state.type !== 'dragging' || state.drag.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            ...drop({
                selection: state.drag.selection,
                resolution: event.resolution,
                pointerType: event.pointerType ?? null,
            }),
            { type: 'lifecycle', event: buildIdleLifecycleEvent() },
        ],
    };
}
