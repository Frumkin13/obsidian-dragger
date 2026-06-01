import { Menu, Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import {
    BLOCK_TYPE_CONVERSION_OPTIONS,
    convertCurrentBlockType,
    deleteCurrentBlock,
} from './block-type-conversion';

export function openBlockTypeMenu(view: EditorView, event: MouseEvent | PointerEvent | null): void {
    const menu = new Menu();
    for (const option of BLOCK_TYPE_CONVERSION_OPTIONS) {
        menu.addItem((item) => item
            .setTitle(option.label)
            .setIcon(option.icon)
            .onClick(() => {
                if (!convertCurrentBlockType(view, option.id)) {
                    new Notice('Unable to change block type.');
                }
            })
        );
    }

    menu.addSeparator();
    menu.addItem((item) => item
        .setTitle('Delete block')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => {
            if (!deleteCurrentBlock(view)) {
                new Notice('Unable to delete block.');
            }
        })
    );

    if (event) {
        menu.showAtMouseEvent(event);
        return;
    }

    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) {
        menu.showAtPosition({ x: coords.left, y: coords.bottom });
        return;
    }

    menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
}
