export type PointerInputKind = 'down' | 'move' | 'up' | 'cancel' | 'lost_capture';
export type KeyboardInputKind = 'keydown';
export type FocusInputKind = 'focusin' | 'blur';
export type VisibilityInputKind = 'visibilitychange';

export type DragPointerInput = {
    kind: PointerInputKind;
    target: HTMLElement | null;
    button: number;
    buttons: number;
    pointerId: number;
    clientX: number;
    clientY: number;
    pointerType: string | null;
    shiftKey: boolean;
};

export type DragKeyboardInput = {
    kind: KeyboardInputKind;
    key: string;
    target: EventTarget | null;
};

export type DragFocusInput = {
    kind: FocusInputKind;
    target: EventTarget | null;
};

export type DragVisibilityInput = {
    kind: VisibilityInputKind;
    visibilityState: DocumentVisibilityState;
};

export type DragInput = DragPointerInput | DragKeyboardInput | DragFocusInput | DragVisibilityInput;

export function readPointerInput(kind: PointerInputKind, event: PointerEvent): DragPointerInput {
    return {
        kind,
        target: event.target instanceof HTMLElement ? event.target : null,
        button: event.button,
        buttons: event.buttons,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerType: event.pointerType || null,
        shiftKey: event.shiftKey,
    };
}

export function readKeyboardInput(kind: KeyboardInputKind, event: KeyboardEvent): DragKeyboardInput {
    return {
        kind,
        key: event.key,
        target: event.target,
    };
}

export function readFocusInput(kind: FocusInputKind, event: FocusEvent | Event): DragFocusInput {
    return {
        kind,
        target: event.target,
    };
}

export function readVisibilityInput(event: Event): DragVisibilityInput {
    void event;
    return {
        kind: 'visibilitychange',
        visibilityState: document.visibilityState,
    };
}
