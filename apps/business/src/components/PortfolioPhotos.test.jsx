import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The editor itself is out of scope here: only whether (and when) it opens.
vi.mock('./PhotoEditor', () => ({ default: () => <div data-testid="photo-editor" /> }));
import PortfolioPhotos from './PortfolioPhotos';

/**
 * A tap on a photo opens the editor from the tile's click, never on pointerup.
 * The browser sends a tap's click after pointerup at the same spot, so an
 * editor opened on pointerup took that click itself: on a phone, tapping the
 * third photo of a row landed on the editor's "Remove photo" and asked to
 * delete a photo nobody meant to touch.
 */
const portfolio = { images: ['https://x.test/a.png', 'https://x.test/b.png', 'https://x.test/c.png'], shape: '1:1', edits: [] };
const setup = () => {
    render(<PortfolioPhotos portfolio={portfolio} onSave={vi.fn()} onAddFiles={vi.fn()} uploading={false} />);
    return screen.getAllByTestId('portfolio-photo');
};
const press = (tile, { x = 50, y = 50, pointerType = 'touch' } = {}) =>
    fireEvent.pointerDown(tile, { button: 0, pointerId: 1, pointerType, clientX: x, clientY: y });
const up = (x = 50, y = 50) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });

describe('PortfolioPhotos — tap to edit', () => {
    // jsdom has no PointerEvent, so pointerType/pointerId would be dropped.
    const hadPointerEvent = 'PointerEvent' in window;
    beforeAll(() => {
        if (!hadPointerEvent) {
            window.PointerEvent = class PointerEvent extends MouseEvent {
                constructor(type, init = {}) {
                    super(type, init);
                    this.pointerId = init.pointerId ?? 0;
                    this.pointerType = init.pointerType ?? '';
                }
            };
        }
    });
    afterAll(() => { if (!hadPointerEvent) delete window.PointerEvent; });
    beforeEach(() => {
        // jsdom has no layout: the drag's hit test finds no slot, which is fine here.
        document.elementFromPoint = () => null;
    });

    it('does not open the editor on pointerup, so the tap’s click cannot land inside it', () => {
        const tiles = setup();
        press(tiles[2]);
        up();
        expect(screen.queryByTestId('photo-editor')).toBeNull();
        fireEvent.click(tiles[2]); // the tap's own click, on the tile it started on
        expect(screen.getByTestId('photo-editor')).toBeInTheDocument();
    });

    it('a mouse drag dropped back on its own tile is not a tap', () => {
        const tiles = setup();
        press(tiles[0], { pointerType: 'mouse' });
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 90, clientY: 50 }); // past the 8px slop: picked up
        up(50, 50);
        fireEvent.click(tiles[0]); // the click the browser sends for that press
        expect(screen.queryByTestId('photo-editor')).toBeNull();
        // ...and the next real click still opens the editor.
        press(tiles[0], { pointerType: 'mouse' });
        up();
        fireEvent.click(tiles[0]);
        expect(screen.getByTestId('photo-editor')).toBeInTheDocument();
    });

    it('Enter on a focused photo opens the editor', () => {
        const tiles = setup();
        fireEvent.keyDown(tiles[1], { key: 'Enter' });
        expect(screen.getByTestId('photo-editor')).toBeInTheDocument();
    });
});
