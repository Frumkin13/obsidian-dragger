import type { BlockCommand } from '../../../domain/command/block-command';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DragDropSnapshot } from '../../../drag/drop/drag-drop-snapshot';

export type PointerDropCommandResult = {
    drop: DragDropSnapshot;
    command: BlockCommand | null;
    didCommit?: boolean;
};

export interface PointerDragTargetClient {
    containsPoint: (clientX: number, clientY: number) => boolean;
    resolveDropSnapshotAtPoint: (
        clientX: number,
        clientY: number,
        source: BlockSelection,
        pointerType: string | null
    ) => DragDropSnapshot;
    previewDropAtPoint: (
        clientX: number,
        clientY: number,
        source: BlockSelection | null,
        pointerType: string | null
    ) => void;
    hideDropIndicator: () => void;
    buildBlockCommandAtPoint?: (
        source: BlockSelection,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ) => PointerDropCommandResult;
    applyBlockCommand?: (command: BlockCommand) => void;
    commitDropAtPoint?: (
        source: BlockSelection,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ) => void;
}

const clients = new Set<PointerDragTargetClient>();
let activeClient: PointerDragTargetClient | null = null;

function resolveClientAtPoint(clientX: number, clientY: number): PointerDragTargetClient | null {
    for (const client of clients) {
        if (client.containsPoint(clientX, clientY)) return client;
    }
    return null;
}

function setActiveClient(nextClient: PointerDragTargetClient | null): void {
    if (activeClient && activeClient !== nextClient) {
        activeClient.hideDropIndicator();
    }
    activeClient = nextClient;
}

export function registerPointerDragTargetClient(client: PointerDragTargetClient): () => void {
    clients.add(client);
    return () => {
        clients.delete(client);
        if (activeClient === client) {
            client.hideDropIndicator();
            activeClient = null;
        }
    };
}

export function previewPointerDropAtPoint(
    fallbackClient: PointerDragTargetClient,
    clientX: number,
    clientY: number,
    source: BlockSelection | null,
    pointerType: string | null
): void {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? fallbackClient;
    setActiveClient(targetClient);
    targetClient.previewDropAtPoint(clientX, clientY, source, pointerType);
}

export function resolvePointerDropSnapshotAtPoint(
    fallbackClient: PointerDragTargetClient,
    clientX: number,
    clientY: number,
    source: BlockSelection,
    pointerType: string | null
): DragDropSnapshot {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? fallbackClient;
    setActiveClient(targetClient);
    return targetClient.resolveDropSnapshotAtPoint(clientX, clientY, source, pointerType);
}

export function buildPointerBlockCommandAtPoint(
    fallbackClient: PointerDragTargetClient,
    source: BlockSelection,
    clientX: number,
    clientY: number,
    pointerType: string | null
): PointerDropCommandResult {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? activeClient ?? fallbackClient;
    setActiveClient(targetClient);
    if (targetClient.buildBlockCommandAtPoint) {
        return targetClient.buildBlockCommandAtPoint(source, clientX, clientY, pointerType);
    }
    if (targetClient.commitDropAtPoint) {
        targetClient.commitDropAtPoint(source, clientX, clientY, pointerType);
        return { drop: { target: null, rejectReason: null }, command: null, didCommit: true };
    }
    return { drop: { target: null, rejectReason: 'no_target' }, command: null };
}

export function applyPointerBlockCommand(
    fallbackClient: PointerDragTargetClient,
    command: BlockCommand
): void {
    const targetClient = activeClient ?? fallbackClient;
    targetClient.applyBlockCommand?.(command);
}

export function commitPointerDropAtPoint(
    fallbackClient: PointerDragTargetClient,
    source: BlockSelection,
    clientX: number,
    clientY: number,
    pointerType: string | null
): void {
    const result = buildPointerBlockCommandAtPoint(fallbackClient, source, clientX, clientY, pointerType);
    if (result.command) {
        applyPointerBlockCommand(fallbackClient, result.command);
    }
}

export function hidePointerDropIndicators(): void {
    for (const client of clients) {
        client.hideDropIndicator();
    }
    activeClient = null;
}

export function resetPointerDragTargetRouterForTests(): void {
    clients.clear();
    activeClient = null;
}
