export class ScrollMonitor {
    private cleanup: (() => void) | null = null;

    bind(target: HTMLElement, onScroll: () => void): void {
        this.cleanup?.();
        const handler = () => onScroll();
        target.addEventListener('scroll', handler, { passive: true });
        this.cleanup = () => target.removeEventListener('scroll', handler);
    }

    destroy(): void {
        this.cleanup?.();
        this.cleanup = null;
    }
}
