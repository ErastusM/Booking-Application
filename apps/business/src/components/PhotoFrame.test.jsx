import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhotoFrame, { WholePhoto, maxCrop, defaultCrop, fitCrop, cropBox, photoFilter, ratioOf } from './PhotoFrame';
import { refitEdits } from './PortfolioPhotos';
import { isDrag, reframe, DRAG_SLOP } from './PhotoEditor';
import { cloudinaryAutoCrop } from '../utils/cloudinary';

// The framing maths the editor, the grid and the client feed all share.
const ratioOfCrop = (c) => (c.w * c.ar) / c.h;
const CLD = 'https://res.cloudinary.com/dktit6s95/image/upload/v1727000000/portfolio/cut.jpg';

describe('PhotoFrame maths', () => {
    it('the biggest crop fills the frame edge to edge', () => {
        expect(maxCrop(16 / 9, 1)).toEqual({ w: 9 / 16, h: 1 }); // wide photo in a square: trim the sides
        expect(maxCrop(0.75, 1.91)).toEqual({ w: 1, h: 0.75 / 1.91 }); // tall photo in a landscape post: trim top/bottom
    });

    it('the editor starts a photo nobody framed from the centre, not the top', () => {
        const tall = defaultCrop(0.75, 1); // 3:4 portrait in a square
        expect(tall.x).toBe(0);
        expect(tall.y).toBeCloseTo(0.125, 9); // the square's middle, not its top 75%
        expect(ratioOfCrop(tall)).toBeCloseTo(1, 9);
        const wide = defaultCrop(16 / 9, 1);
        expect(wide.y).toBe(0);
        expect(wide.x + wide.w / 2).toBeCloseTo(0.5, 9);
    });

    it('re-fits a framing to a new shape with the same centre and zoom', () => {
        const square = { x: 0.25, y: 0.1, w: 0.5, h: 0.5, ar: 1 }; // zoom 2 on a square photo
        const portrait = fitCrop(square, 0.8);
        expect(ratioOfCrop(portrait)).toBeCloseTo(0.8, 9);
        expect(portrait.x + portrait.w / 2).toBeCloseTo(0.5, 9);
        expect(portrait.y + portrait.h / 2).toBeCloseTo(0.35, 9);
        expect(maxCrop(1, 0.8).w / portrait.w).toBeCloseTo(2, 9);
        // and fitting again to the same shape changes nothing
        expect(fitCrop(portrait, 0.8)).toEqual(portrait);
    });

    it('keeps a re-fitted crop inside the photo', () => {
        const corner = fitCrop({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, ar: 1 }, 1.91);
        expect(corner.x + corner.w).toBeLessThanOrEqual(1);
        expect(corner.y + corner.h).toBeLessThanOrEqual(1);
    });

    it('draws a crop by scaling the photo up behind the frame', () => {
        expect(cropBox({ x: 0.25, y: 0, w: 0.5, h: 1 })).toMatchObject({ width: '200%', height: '100%', left: '-50%', top: '0%' });
    });

    it('fills the frame from the centre when there is no crop', () => {
        expect(cropBox(null)).toMatchObject({ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 50%' });
    });

    it('turns adjustments into a filter only when there are any', () => {
        expect(photoFilter({})).toBeUndefined();
        expect(photoFilter({ brightness: 20, saturation: -100 })).toBe('brightness(1.1) saturate(0)');
        expect(photoFilter({ warmth: 40 }, 'w1')).toBe('url(#w1)');
    });

    it('re-fits every photo when the post shape changes; adjustments stay', () => {
        const out = refitEdits({
            a: { x: 0.25, y: 0.1, w: 0.5, h: 0.5, ar: 1, contrast: 10 },
            b: { brightness: 5 },
            c: { x: 0, y: 0, w: 0.5, h: 0.5, warmth: 20 }, // no photo shape known → automatic framing
        }, ratioOf('4:5'));
        expect(ratioOfCrop(out.a)).toBeCloseTo(0.8, 9);
        expect(out.a.contrast).toBe(10);
        expect(out.b).toEqual({ brightness: 5 });
        expect(out.c).toEqual({ warmth: 20 });
    });
});

// Photos nobody framed are cropped by Cloudinary around their subject, in the post shape.
describe('automatic framing', () => {
    it('asks Cloudinary for a subject-aware crop in each post shape', () => {
        const at = (shape) => cloudinaryAutoCrop(CLD, shape, 1000);
        expect(at('1:1')).toBe('https://res.cloudinary.com/dktit6s95/image/upload/c_fill,g_auto,ar_1:1,w_1000,q_auto:good,f_auto/v1727000000/portfolio/cut.jpg');
        expect(at('4:5')).toContain('/image/upload/c_fill,g_auto,ar_4:5,w_1000,q_auto:good,f_auto/v1727000000/');
        expect(at('1.91:1')).toContain('/image/upload/c_fill,g_auto,ar_1.91,w_1000,q_auto:good,f_auto/v1727000000/'); // decimal: what Cloudinary accepts
        expect(cloudinaryAutoCrop(CLD, 'nonsense', 400)).toContain('c_fill,g_auto,ar_1:1,w_400,'); // same fallback as ratioOf
    });

    it('leaves photos hosted anywhere else alone', () => {
        const google = 'https://lh3.googleusercontent.com/a/abc=s96-c';
        expect(cloudinaryAutoCrop(google, '4:5', 1000)).toBe(google);
        expect(cloudinaryAutoCrop('http://localhost:3003/test-photos/portrait.png', '1:1', 1000)).toBe('http://localhost:3003/test-photos/portrait.png');
        expect(cloudinaryAutoCrop('', '1:1', 1000)).toBe('');
    });

    const img = () => screen.getByRole('img');

    it('draws an unframed Cloudinary photo from the automatic crop, adjustments and all', () => {
        render(<PhotoFrame src={CLD} shape="4:5" width={1000} edit={{ url: CLD, brightness: 20 }} alt="cut" />);
        expect(img().getAttribute('src')).toBe(cloudinaryAutoCrop(CLD, '4:5', 1000));
        expect(img().style.filter).toBe('brightness(1.1)');
        expect(img().style.width).toBe('100%');
    });

    it('caps the automatic crop at 2400px', () => {
        render(<PhotoFrame src={CLD} width={5000} alt="cut" />);
        expect(img().getAttribute('src')).toContain('ar_1:1,w_2400,');
    });

    it('fills the frame from the centre with an unframed photo from elsewhere', () => {
        const src = 'http://localhost:3003/test-photos/portrait.png';
        render(<PhotoFrame src={src} shape="1:1" alt="cut" />);
        expect(img().getAttribute('src')).toBe(src);
        expect(img().style.objectFit).toBe('cover');
        expect(img().style.objectPosition).toBe('50% 50%');
    });

    it("keeps a framed photo on the owner's crop of the whole picture", () => {
        const edit = { url: CLD, x: 0.25, y: 0.1, w: 0.5, h: 0.5, ar: 1 }; // zoom 2, square
        render(<PhotoFrame src={CLD} shape="1:1" width={1000} edit={edit} alt="cut" />);
        expect(img().getAttribute('src')).toContain('/image/upload/c_limit,w_2000,q_auto:good,f_auto/'); // twice the pixels for zoom 2
        expect(img().getAttribute('src')).not.toContain('g_auto');
        expect(img().style.width).toBe('200%');
        expect(img().style.top).toBe('-20%');
    });

    it('shows a photo whole in the full-screen view, with its adjustments', () => {
        render(<WholePhoto src={CLD} width={1400} edit={{ url: CLD, contrast: 40 }} alt="cut" />);
        expect(img().getAttribute('src')).toContain('/image/upload/c_limit,w_1400,');
        expect(img().style.filter).toBe('contrast(1.2)');
    });
});

// The editor: only the owner's real intent frames a photo by hand.
describe('PhotoEditor intent', () => {
    it('a tap that jitters a few pixels is not a drag', () => {
        const landed = { x: 100, y: 100 };
        [[101, 100], [102, 101], [99, 98], [103, 102], [100 + DRAG_SLOP, 100]].forEach(([x, y]) => expect(isDrag(landed, { x, y })).toBe(false));
        expect(isDrag(landed, { x: 103, y: 103 })).toBe(true); // 4.2px
        expect(isDrag(landed, { x: 100, y: 130 })).toBe(true);
    });

    it('a gesture that changes nothing leaves the photo on automatic framing', () => {
        const auto = { crop: defaultCrop(0.75, 1), touched: false };
        expect(reframe(auto, { ...auto.crop })).toBe(auto); // e.g. zooming out at the widest
        expect(reframe(auto, { ...auto.crop, y: auto.crop.y + 1e-9 })).toBe(auto);
        expect(reframe({ crop: null, touched: false }, auto.crop)).toEqual({ crop: null, touched: false }); // still loading
    });

    it('a real move or zoom makes it framed by hand', () => {
        const auto = { crop: defaultCrop(0.75, 1), touched: false };
        const moved = reframe(auto, { ...auto.crop, y: 0.05 });
        expect(moved).toEqual({ crop: { ...auto.crop, y: 0.05 }, touched: true });
        const zoomed = reframe(auto, { ...auto.crop, w: 0.5, h: 0.375 });
        expect(zoomed.touched).toBe(true);
    });
});
