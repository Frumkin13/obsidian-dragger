import { EditorView } from '@codemirror/view';
import { HANDLE_INTERACTION_ZONE_PX } from '../../shared/constants';

export type HoverContentRect = Pick<DOMRect | DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>;

export interface HoverPointerSnapshot {
    clientX: number;
    clientY: number;
    contentRect: HoverContentRect;
    gutterSide: 'left' | 'right';
    withinContent: boolean;
    withinHandleInteractionZone: boolean;
    withinHoverActivationZone: boolean;
}

export function createHoverPointerSnapshot(
    view: EditorView,
    clientX: number,
    clientY: number,
    gutterSide: 'left' | 'right'
): HoverPointerSnapshot {
    const contentRect = view.contentDOM.getBoundingClientRect();
    const withinVerticalBounds = clientY >= contentRect.top && clientY <= contentRect.bottom;
    const withinContent = withinVerticalBounds
        && clientX >= contentRect.left
        && clientX <= contentRect.right;
    const anchorX = gutterSide === 'right' ? contentRect.right : contentRect.left;
    const withinHandleInteractionZone = withinVerticalBounds
        && clientX >= anchorX - HANDLE_INTERACTION_ZONE_PX
        && clientX <= anchorX + HANDLE_INTERACTION_ZONE_PX;

    return {
        clientX,
        clientY,
        contentRect,
        gutterSide,
        withinContent,
        withinHandleInteractionZone,
        withinHoverActivationZone: withinContent || withinHandleInteractionZone,
    };
}
