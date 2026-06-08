import type { BlockCommand } from '../../../domain/command/block-command';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DragDropSnapshot, DropResolution } from '../../../drag/pipeline/pipeline-drop';

export type PointerDropCommitResolution = DropResolution;

export interface PointerDragTargetClient {
    containsPoint: (clientX: number, clientY: number) => boolean;
    resolveDropSnapshotAtPoint: (
        clientX: number,
        clientY: number,
        source: BlockSelection,
        pointerType: string | null
    ) => DragDropSnapshot;
    showDropPreview: (source: BlockSelection, drop: DragDropSnapshot, pointerType: string | null) => void;
    hideDropPreview: () => void;
    buildBlockCommandAtPoint: (
        source: BlockSelection,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ) => PointerDropCommitResolution;
    applyBlockCommand: (command: BlockCommand) => void;
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
        activeClient.hideDropPreview();
    }
    activeClient = nextClient;
}

export function registerPointerDragTargetClient(client: PointerDragTargetClient): () => void {
    clients.add(client);
    return () => {
        clients.delete(client);
        if (activeClient === client) {
            client.hideDropPreview();
            activeClient = null;
        }
    };
}

export function showPointerDropPreview(
    fallbackClient: PointerDragTargetClient,
    source: BlockSelection,
    drop: DragDropSnapshot,
    pointerType: string | null
): void {
    const targetClient = activeClient ?? fallbackClient;
    targetClient.showDropPreview(source, drop, pointerType);
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
): PointerDropCommitResolution {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? activeClient ?? fallbackClient;
    setActiveClient(targetClient);
    return targetClient.buildBlockCommandAtPoint(source, clientX, clientY, pointerType);
}

export function applyPointerBlockCommand(
    fallbackClient: PointerDragTargetClient,
    command: BlockCommand
): void {
    const targetClient = activeClient ?? fallbackClient;
    targetClient.applyBlockCommand(command);
}

export function hidePointerDropPreviews(): void {
    for (const client of clients) {
        client.hideDropPreview();
    }
    activeClient = null;
}

export function resetPointerDragTargetRouterForTests(): void {
    clients.clear();
    activeClient = null;
}
