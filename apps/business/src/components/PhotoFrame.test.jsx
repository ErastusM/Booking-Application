import { describe, it, expect } from 'vitest';
import { maxCrop, defaultCrop, fitCrop, cropBox, photoFilter, ratioOf } from './PhotoFrame';
import { refitEdits } from './PortfolioPhotos';

// The framing maths the editor, the grid and the client feed all share.
const ratioOfCrop = (c) => (c.w * c.ar) / c.h;

describe('PhotoFrame maths', () => {
    it('the biggest crop fills the frame edge to edge', () => {
        expect(maxCrop(16 / 9, 1)).toEqual({ w: 9 / 16, h: 1 }); // wide photo in a square: trim the sides
        expect(maxCrop(0.75, 1.91)).toEqual({ w: 1, h: 0.75 / 1.91 }); // tall photo in a landscape post: trim top/bottom
    });

    it('an unframed photo is anchored to the top — the haircut, not the collar', () => {
        const c = defaultCrop(0.75, 1);
        expect(c.y).toBe(0);
        expect(c.x).toBe(0);
        expect(ratioOfCrop(c)).toBeCloseTo(1, 9);
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
        expect(cropBox(null)).toMatchObject({ objectFit: 'cover', objectPosition: 'center top' });
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
            c: { x: 0, y: 0, w: 0.5, h: 0.5, warmth: 20 }, // no photo shape known → automatic fill
        }, ratioOf('4:5'));
        expect(ratioOfCrop(out.a)).toBeCloseTo(0.8, 9);
        expect(out.a.contrast).toBe(10);
        expect(out.b).toEqual({ brightness: 5 });
        expect(out.c).toEqual({ warmth: 20 });
    });
});
