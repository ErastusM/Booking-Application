import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhotoEditor from './PhotoEditor';

/**
 * A tap on a phone jitters a pixel or two. The editor used to treat ANY
 * pointer movement as the owner framing the photo, so opening a photo and
 * pressing Done saved a hand-made crop that locked it out of automatic
 * framing. These drive the real handlers (jsdom has no layout, so the stage
 * size and the photo's shape are stubbed).
 */
const PHOTO = 'http://localhost:3003/test-photos/portrait.png';

beforeEach(() => {
    // A 3:4 portrait that "loads" at once, and a 400x600 stage.
    vi.stubGlobal('Image', class { set src(_) { this.naturalWidth = 750; this.naturalHeight = 1000; setTimeout(() => this.onload?.()); } });
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { this.cb = cb; } observe() { this.cb([{ contentRect: { width: 400, height: 600 } }]); } disconnect() {} });
    if (!window.PointerEvent) {
        vi.stubGlobal('PointerEvent', class extends MouseEvent { constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId; } });
    }
});
afterEach(() => vi.unstubAllGlobals());

const open = async (props = {}) => {
    const onDone = vi.fn();
    render(<PhotoEditor url={PHOTO} shape="1:1" isCover onDone={onDone} onCancel={() => {}} onRemove={() => {}} {...props} />);
    await waitFor(() => expect(screen.queryByText('Loading photo…')).toBeNull());
    const stage = screen.getByLabelText(/Drag to move/);
    const drag = (points) => {
        const [[x0, y0], ...rest] = points;
        fireEvent.pointerDown(stage, { pointerId: 1, clientX: x0, clientY: y0 });
        rest.forEach(([x, y]) => fireEvent.pointerMove(stage, { pointerId: 1, clientX: x, clientY: y }));
        fireEvent.pointerUp(stage, { pointerId: 1 });
    };
    const done = () => { fireEvent.click(screen.getByTestId('photo-editor-done')); return onDone.mock.calls.at(-1)[0]; };
    return { stage, drag, done };
};
const note = () => screen.getByTestId('photo-framing-note').textContent;

describe('PhotoEditor', () => {
    it('tells the owner an unframed photo is framed automatically', async () => {
        await open();
        expect(note()).toMatch(/^Automatic framing\./);
    });

    it('a jittery tap saves no crop', async () => {
        const { drag, done } = await open();
        drag([[200, 300], [201, 300], [202, 301], [200, 302], [203, 301], [201, 299]]);
        expect(note()).toMatch(/^Automatic framing\./);
        expect(done()).toEqual({ edit: null, shape: '1:1' });
    });

    it('zooming out at the widest changes nothing', async () => {
        const { stage, done } = await open();
        fireEvent.keyDown(stage, { key: '-' });
        expect(done().edit).toBeNull();
    });

    it('a real drag frames the photo by hand, from where the finger landed', async () => {
        const { drag, done } = await open();
        drag([[200, 300], [200, 303], [200, 330]]); // 30px down in total, past the slop
        expect(note()).toMatch(/^Framed by you\./);
        const { edit } = done();
        // The centred start (y 0.125) moved up by 30px of a 360px frame: 30/360 * 0.75.
        expect(edit.y).toBeCloseTo(0.125 - (30 / 360) * 0.75, 3);
        expect(edit).toMatchObject({ url: PHOTO, x: 0, w: 1, h: 0.75, ar: 0.75 });
    });

    it('Reset goes back to automatic framing', async () => {
        const { stage, done } = await open();
        fireEvent.keyDown(stage, { key: '+' });
        expect(note()).toMatch(/^Framed by you\./);
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(note()).toMatch(/^Automatic framing\./);
        expect(done().edit).toBeNull();
    });

    it('changing the post shape keeps an unframed photo unframed; adjustments still save', async () => {
        const { done } = await open({ edit: { url: PHOTO, brightness: 20 } });
        fireEvent.click(screen.getByTestId('photo-shape-4:5'));
        expect(note()).toMatch(/^Automatic framing\./);
        expect(done()).toEqual({ edit: { url: PHOTO, brightness: 20 }, shape: '4:5' });
    });

    it('opens a photo the owner framed as framed by hand', async () => {
        const { done } = await open({ edit: { url: PHOTO, x: 0, y: 0.2, w: 1, h: 0.75, ar: 0.75 } });
        expect(note()).toMatch(/^Framed by you\./);
        expect(done().edit).toMatchObject({ y: 0.2, h: 0.75 });
    });
});
