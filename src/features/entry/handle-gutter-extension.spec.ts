// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandleGutterExtension } from './handle-gutter-extension';
import {
    CODEMIRROR_AFTER_GUTTERS_SELECTOR,
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    HANDLE_GUTTER_CLASS,
    HANDLE_GUTTER_PROBE_CLASS,
} from '../../shared/dom-selectors';

const mountedViews: EditorView[] = [];

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.innerHTML = '';
});

describe('createHandleGutterExtension', () => {
    it('does not inject a hidden spacer gutter element ahead of real line markers', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        const view = new EditorView({
            state: EditorState.create({
                doc: 'alpha\nbeta',
                extensions: [createHandleGutterExtension()],
            }),
            parent: host,
        });
        mountedViews.push(view);

        const gutter = view.dom.querySelector<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`);
        expect(gutter).not.toBeNull();

        const gutterElements = Array.from(gutter!.querySelectorAll<HTMLElement>(CODEMIRROR_GUTTER_ELEMENT_SELECTOR));
        expect(gutterElements.length).toBeGreaterThan(0);
        expect(gutterElements.every((el) => el.querySelector(`.${HANDLE_GUTTER_PROBE_CLASS}`) !== null)).toBe(true);
    });

    it('mounts the handle gutter on the editor right side when configured', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        const view = new EditorView({
            state: EditorState.create({
                doc: 'alpha\nbeta',
                extensions: [createHandleGutterExtension('right')],
            }),
            parent: host,
        });
        mountedViews.push(view);

        const gutter = view.dom.querySelector<HTMLElement>(`${CODEMIRROR_AFTER_GUTTERS_SELECTOR} .${HANDLE_GUTTER_CLASS}`);
        expect(gutter).not.toBeNull();
    });
});
