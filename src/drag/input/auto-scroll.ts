export function autoScrollNearViewportEdge(scroller: HTMLElement, clientY: number): boolean {
    const rect = scroller.getBoundingClientRect();
    const topEdgeZone = 88;
    const bottomEdgeZone = 88;
    let delta = 0;
    if (clientY < rect.top + topEdgeZone) {
        delta = -Math.min(22, ((rect.top + topEdgeZone) - clientY) * 0.35 + 2);
    } else if (clientY > rect.bottom - bottomEdgeZone) {
        delta = Math.min(22, (clientY - (rect.bottom - bottomEdgeZone)) * 0.35 + 2);
    }
    if (delta === 0) return false;
    const previousScrollTop = scroller.scrollTop;
    scroller.scrollTop += delta;
    return scroller.scrollTop !== previousScrollTop;
}
