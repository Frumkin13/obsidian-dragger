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

export type BeginDragPipelineResult = {
    drag: ActiveDrag;
    effects: DragEffect[];
};

export function beginDragPipeline(input: BeginDragInput): BeginDragPipelineResult {
    const drag = beginActiveDrag({
        selection: input.selection,
        pointerId: input.pointerId,
        pointerType: input.pointerType,
    });
    return {
        drag,
        effects: [
            { type: 'emit_lifecycle', event: buildDragStartedLifecycleEvent(input.selection, input.pointerType) },
            { type: 'show_drop_preview', selection: input.selection, drop: input.drop },
            buildTargetChangedEffect(input.selection, input.drop, input.pointerType),
        ],
    };
}

export function updateDragPipeline(drag: ActiveDrag, input: PreviewDragInput): DragEffect[] {
    if (input.pointerId !== drag.pointerId) return [];
    drag.pointerType = input.pointerType || drag.pointerType;
    return [
        { type: 'show_drop_preview', selection: drag.selection, drop: input.drop },
        buildTargetChangedEffect(drag.selection, input.drop, input.pointerType),
    ];
}

export function commitDragPipeline(drag: ActiveDrag, input: CommitDragInput): DragEffect[] {
    if (input.pointerId !== drag.pointerId) return [];
    if (!input.command && !input.didCommit) {
        return [
            { type: 'hide_drop_preview' },
            {
                type: 'emit_lifecycle',
                event: buildCancelledLifecycleEvent({
                    source: drag.selection,
                    targetLine: input.drop.target?.targetLineNumber ?? null,
                    listIntent: input.drop.target?.listIntent ?? null,
                    rejectReason: input.drop.rejectReason ?? 'no_target',
                    pointerType: input.pointerType,
                }),
            },
        ];
    }
    const effects: DragEffect[] = [];
    if (input.command) {
        effects.push({ type: 'apply_command', command: input.command });
    }
    effects.push(
        {
            type: 'emit_lifecycle',
            event: buildDropCommitLifecycleEvent({
                source: drag.selection,
                targetLine: input.drop.target?.targetLineNumber ?? null,
                listIntent: input.drop.target?.listIntent ?? null,
                pointerType: input.pointerType,
            }),
        },
    );
    return effects;
}

export function cancelDragPipeline(drag: ActiveDrag, input: CancelDragInput): DragEffect[] {
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

function buildTargetChangedEffect(
    selection: ActiveDrag['selection'],
    drop: DragDropSnapshot,
    pointerType: string | null
): DragEffect {
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
