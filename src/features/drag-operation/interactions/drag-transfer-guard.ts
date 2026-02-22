export type DragTransferDecision = 'ignore' | 'allow' | 'block';

export type DragTransferGuardResult = {
    decision: DragTransferDecision;
    dropEffect: DataTransfer['dropEffect'];
};

export function resolveDragTransferGuard(params: {
    event: DragEvent;
    isCrossEditorDrag: boolean;
    isCrossFileDragEnabled: boolean;
}): DragTransferGuardResult {
    const { event, isCrossEditorDrag, isCrossFileDragEnabled } = params;
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
        return {
            decision: 'ignore',
            dropEffect: 'none',
        };
    }

    const hasPluginPayloadType = Array.from(dataTransfer.types).includes('application/dnd-block');
    if (!hasPluginPayloadType) {
        return {
            decision: 'ignore',
            dropEffect: 'none',
        };
    }

    if (!isCrossEditorDrag || isCrossFileDragEnabled) {
        return {
            decision: 'allow',
            dropEffect: 'move',
        };
    }

    return {
        decision: 'block',
        dropEffect: 'none',
    };
}
