import { DragSource } from '../shared/types/drag';

export interface PointerDragTargetClient {
    containsPoint: (clientX: number, clientY: number) => boolean;
    scheduleDropIndicatorUpdate: (
        clientX: number,
        clientY: number,
        source: DragSource | null,
        pointerType: string | null
    ) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (
        source: DragSource,
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

export function schedulePointerDropIndicatorFromPoint(
    fallbackClient: PointerDragTargetClient,
    clientX: number,
    clientY: number,
    source: DragSource | null,
    pointerType: string | null
): void {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? fallbackClient;
    setActiveClient(targetClient);
    targetClient.scheduleDropIndicatorUpdate(clientX, clientY, source, pointerType);
}

export function performPointerDropAtPoint(
    fallbackClient: PointerDragTargetClient,
    source: DragSource,
    clientX: number,
    clientY: number,
    pointerType: string | null
): void {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? activeClient ?? fallbackClient;
    targetClient.performDropAtPoint(source, clientX, clientY, pointerType);
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
