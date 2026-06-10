import { Menu, Notice, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import {
    copyCurrentBlock,
    cutCurrentBlock,
    deleteCurrentBlock,
    HEADING_BLOCK_TYPE_OPTIONS,
    LIST_BLOCK_TYPE_OPTIONS,
    PARAGRAPH_BLOCK_TYPE_OPTION,
    SIMPLE_BLOCK_TYPE_OPTIONS,
    type BlockTypeConversionOption,
    convertCurrentBlockType,
} from './block-type-conversion';

type BlockMenuAction = {
    label: string;
    icon: string;
    warning?: boolean;
    run: () => boolean | Promise<boolean>;
    failureNotice: string;
};

type BlockTypeMenuRow = {
    label: string;
    icon: string;
    chevron?: boolean;
    run: (trigger: HTMLElement) => void;
};

export function openBlockTypeMenu(view: EditorView, event: MouseEvent | PointerEvent | null): void {
    const menu = new Menu();

    addConversionItem(menu, view, PARAGRAPH_BLOCK_TYPE_OPTION);
    addNestedConversionMenu(menu, view, {
        label: 'Heading',
        icon: 'heading',
        options: HEADING_BLOCK_TYPE_OPTIONS,
    });
    addNestedConversionMenu(menu, view, {
        label: 'List',
        icon: 'list',
        options: LIST_BLOCK_TYPE_OPTIONS,
    });
    for (const option of SIMPLE_BLOCK_TYPE_OPTIONS) {
        addConversionItem(menu, view, option);
    }

    menu.addSeparator();
    addActionRow(menu, [
        {
            label: 'Copy block',
            icon: 'copy',
            run: () => copyCurrentBlock(view),
            failureNotice: 'Unable to copy block.',
        },
        {
            label: 'Cut block',
            icon: 'scissors',
            run: () => cutCurrentBlock(view),
            failureNotice: 'Unable to cut block.',
        },
        {
            label: 'Delete block',
            icon: 'trash-2',
            warning: true,
            run: () => deleteCurrentBlock(view),
            failureNotice: 'Unable to delete block.',
        },
    ]);

    showMenu(menu, view, event);
}

function addConversionItem(menu: Menu, view: EditorView, option: BlockTypeConversionOption): void {
    addMenuRow(menu, {
        label: option.label,
        icon: option.icon,
        run: () => {
            if (!convertCurrentBlockType(view, option.target)) {
                new Notice('Unable to change block type.');
                return;
            }
            menu.hide();
        },
    });
}

function addNestedConversionMenu(
    menu: Menu,
    view: EditorView,
    group: {
        label: string;
        icon: string;
        options: BlockTypeConversionOption[];
    }
): void {
    addMenuRow(menu, {
        label: group.label,
        icon: group.icon,
        chevron: true,
        run: (trigger) => {
            const child = new Menu();
            for (const option of group.options) {
                addConversionItem(child, view, option);
            }
            showNestedMenu(child, trigger);
        },
    });
}

function addMenuRow(menu: Menu, row: BlockTypeMenuRow): void {
    const trigger = createMenuRowTrigger(row);
    const fragment = activeDocument.createDocumentFragment();
    fragment.appendChild(trigger);
    menu.addItem((item) => item
        .setTitle(fragment)
        .setIcon(null)
        .setIsLabel(true)
    );
}

function createMenuRowTrigger(row: BlockTypeMenuRow): HTMLDivElement {
    const trigger = activeDocument.createElement('div');
    trigger.className = 'clickable-icon dnd-block-type-menu-row';
    trigger.setAttribute('role', 'button');
    trigger.tabIndex = 0;
    trigger.setAttribute('aria-label', row.label);

    const icon = activeDocument.createElement('span');
    icon.className = 'dnd-block-type-menu-row-icon';
    setIcon(icon, row.icon);

    const label = activeDocument.createElement('span');
    label.className = 'dnd-block-type-menu-row-label';
    label.textContent = row.label;

    const chevron = activeDocument.createElement('span');
    chevron.className = 'dnd-block-type-menu-row-chevron';
    if (row.chevron) {
        setIcon(chevron, 'chevron-right');
    }

    trigger.append(icon, label, chevron);
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.run(trigger);
    });
    trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        row.run(trigger);
    });
    return trigger;
}

function addActionRow(menu: Menu, actions: BlockMenuAction[]): void {
    const row = activeDocument.createElement('div');
    row.className = 'dnd-block-type-action-row';
    for (const action of actions) {
        row.appendChild(createActionButton(menu, action));
    }

    const fragment = activeDocument.createDocumentFragment();
    fragment.appendChild(row);
    menu.addItem((item) => item
        .setTitle(fragment)
        .setIcon(null)
        .setIsLabel(true)
    );
}

function createActionButton(menu: Menu, action: BlockMenuAction): HTMLDivElement {
    const button = activeDocument.createElement('div');
    button.className = 'clickable-icon dnd-block-type-action-button';
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    if (action.warning) {
        button.classList.add('is-warning');
        button.classList.add('mod-warning');
    }
    button.setAttribute('aria-label', action.label);
    button.setAttribute('title', action.label);
    setIcon(button, action.icon);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void executeMenuAction(menu, action);
    });
    button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        void executeMenuAction(menu, action);
    });
    return button;
}

async function executeMenuAction(menu: Menu, action: BlockMenuAction): Promise<void> {
    const ok = await action.run();
    if (!ok) {
        new Notice(action.failureNotice);
        return;
    }
    menu.hide();
}

function markMenuItems(): void {
    const rows = activeDocument.querySelectorAll('.dnd-block-type-menu-row, .dnd-block-type-action-row');
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const menuItem = row.closest('.menu-item');
        if (menuItem && !menuItem.classList.contains('dnd-custom-menu-item')) {
            menuItem.classList.add('dnd-custom-menu-item');
        }
    }
}

function showNestedMenu(menu: Menu, trigger: HTMLElement): void {
    const rect = trigger.getBoundingClientRect();
    menu.showAtPosition({
        x: rect.right,
        y: rect.top,
        width: rect.width,
        overlap: true,
    });
    markMenuItems();
}

function showMenu(menu: Menu, view: EditorView, event: MouseEvent | PointerEvent | null): void {
    if (event) {
        menu.showAtMouseEvent(event);
        markMenuItems();
        return;
    }

    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) {
        menu.showAtPosition({ x: coords.left, y: coords.bottom });
        markMenuItems();
        return;
    }

    menu.showAtPosition({ x: activeWindow.innerWidth / 2, y: activeWindow.innerHeight / 2 });
    markMenuItems();
}
