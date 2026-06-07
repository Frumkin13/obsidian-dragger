export function isHTMLElement(value: unknown): value is HTMLElement {
    return value instanceof HTMLElement;
}

export function closestOrNull<T extends Element>(node: Element | null, selector: string): T | null {
    if (!node) return null;
    return node.closest<T>(selector);
}

export function toElement(node: EventTarget | null): Element | null {
    return node instanceof Element ? node : null;
}
