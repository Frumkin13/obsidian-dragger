export interface KeyboardHandlerOptions {
    onEscape?: () => void;
}

export class KeyboardHandler {
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            this.options.onEscape?.();
        }
    };

    constructor(private readonly options: KeyboardHandlerOptions = {}) {}

    attach(): void {
        window.addEventListener('keydown', this.onKeyDown, true);
    }

    detach(): void {
        window.removeEventListener('keydown', this.onKeyDown, true);
    }
}
