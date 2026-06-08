import { beginActiveDrag, type ActiveDrag } from '../state/drag-state';
import {
    buildCancelledLifecycleEvent,
    buildDragStartedLifecycleEvent,
    buildDragTargetChangedLifecycleEvent,
    buildDropCommitLifecycleEvent,
} from '../lifecycle/drag-lifecycle';
import type { DragDropSnapshot } from '../drop/drag-drop-snapshot';
import type { DragEffect } from '../effects/drag-effect';
import type { BeginDragInput, CancelDragInput, CommitDragInput, PreviewDragInput } from './drag-input';

export type BeginDragPipelineResult<TPreview = unknown> = {
    drag: ActiveDrag;
    effects: DragEffect<TPreview>[];
};

export function beginDragPipeline<TPreview>(input: BeginDragInput<TPreview>): BeginDragPipelineResult<TPreview> {
    const drag = beginActiveDrag({
        selection: input.selection,
        pointerId: input.pointerId,
        pointerType: input.pointerType,
    });
    return {
        drag,
        effects: [
            { type: 'emit_lifecycle', event: buildDragStartedLifecycleEvent(input.selection, input.pointerType) },
            { type: 'show_drop_preview', selection: input.selection, drop: input.drop, pointerType: input.pointerType },
            buildTargetChangedEffect(input.selection, input.drop, input.pointerType),
        ],
    };
}

export function updateDragPipeline<TPreview>(drag: ActiveDrag, input: PreviewDragInput<TPreview>): DragEffect<TPreview>[] {
    if (input.pointerId !== drag.pointerId) return [];
    drag.pointerType = input.pointerType || drag.pointerType;
    return [
        { type: 'show_drop_preview', selection: drag.selection, drop: input.drop, pointerType: input.pointerType },
        buildTargetChangedEffect(drag.selection, input.drop, input.pointerType),
    ];
}

export function commitDragPipeline<TPreview>(drag: ActiveDrag, input: CommitDragInput<TPreview>): DragEffect<TPreview>[] {
    if (input.pointerId !== drag.pointerId) return [];
    if (input.resolution.type === 'cancel') {
        return [
            { type: 'hide_drop_preview' },
            {
                type: 'emit_lifecycle',
                event: buildCancelledLifecycleEvent({
                    source: drag.selection,
                    targetLine: input.resolution.drop.target?.targetLineNumber ?? null,
                    listIntent: input.resolution.drop.target?.listIntent ?? null,
                    rejectReason: input.resolution.reason ?? input.resolution.drop.rejectReason ?? 'no_target',
                    pointerType: input.pointerType,
                }),
            },
        ];
    }
    const effects: DragEffect<TPreview>[] = [];
    if (input.resolution.type === 'command') {
        effects.push({ type: 'apply_command', command: input.resolution.command });
    }
    effects.push(
        {
            type: 'emit_lifecycle',
            event: buildDropCommitLifecycleEvent({
                source: drag.selection,
                targetLine: input.resolution.drop.target?.targetLineNumber ?? null,
                listIntent: input.resolution.drop.target?.listIntent ?? null,
                pointerType: input.pointerType,
            }),
        },
    );
    return effects;
}

export function cancelDragPipeline(drag: ActiveDrag, input: CancelDragInput): DragEffect<unknown>[] {
    if (input.pointerId !== drag.pointerId) return [];
    return [
        { type: 'hide_drop_preview' },
        {
            type: 'emit_lifecycle',
            event: buildCancelledLifecycleEvent({
                source: drag.selection,
                rejectReason: input.reason,
                pointerType: input.pointerType,
            }),
        },
    ];
}

function buildTargetChangedEffect<TPreview>(
    selection: ActiveDrag['selection'],
    drop: DragDropSnapshot<TPreview>,
    pointerType: string | null
): DragEffect<TPreview> {
    return {
        type: 'emit_lifecycle',
        event: buildDragTargetChangedLifecycleEvent({
            source: selection,
            targetLine: drop.target?.targetLineNumber ?? null,
            listIntent: drop.target?.listIntent ?? null,
            rejectReason: drop.rejectReason ?? null,
            pointerType,
        }),
    };
}
