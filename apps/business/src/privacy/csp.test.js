/**
 * Both apps ship an ENFORCED Content-Security-Policy in serve.json (compliance
 * audit point 10). The Docker image copies apps/<app>/serve.json over the one
 * Vite copies from public/, so the two must be identical — before this, the
 * image's copy silently dropped every security header.
 *
 * The inline boot script in index.html (theme + splash) is allowed by its
 * sha256 hash, so editing that script without updating the hash would blank the
 * app in production: this test recomputes it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cspOf = (json) => {
    const all = JSON.parse(json).headers.flatMap((h) => h.headers.map((x) => ({ ...x, source: h.source })));
    expect(all.find((h) => h.key === 'Content-Security-Policy-Report-Only')).toBeUndefined();
    const h = all.find((x) => x.key === 'Content-Security-Policy' && x.source === '**');
    expect(h).toBeTruthy();
    return Object.fromEntries(h.value.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
};

for (const app of ['customer', 'business']) {
    describe(`${app} CSP`, () => {
        const json = read(`${app}/serve.json`);

        it('is identical in serve.json and public/serve.json', () => {
            expect(read(`${app}/public/serve.json`)).toBe(json);
        });

        it('allows the inline boot script by hash, and no inline/eval script at all', () => {
            const csp = cspOf(json);
            const html = read(`${app}/index.html`);
            const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
                .filter((m) => !/application\/ld\+json/.test(m[1]));
            expect(inline.length).toBeGreaterThan(0);
            for (const m of inline) {
                const hash = `'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`;
                expect(csp['script-src']).toContain(hash);
            }
            expect(csp['script-src']).not.toContain("'unsafe-inline'");
            expect(csp['script-src']).not.toContain("'unsafe-eval'");
        });

        it('covers the real third parties and nothing broad', () => {
            const csp = cspOf(json);
            expect(csp['default-src']).toEqual(["'self'"]);
            expect(csp['object-src']).toEqual(["'none'"]);
            expect(csp['connect-src']).toEqual(expect.arrayContaining(['https://api.bookplus.pro', 'https://api.cloudinary.com', 'https://nominatim.openstreetmap.org']));
            expect(csp['img-src']).toEqual(expect.arrayContaining(['https://res.cloudinary.com']));
            for (const list of Object.values(csp)) {
                expect(list).not.toContain('*');
                expect(list).not.toContain('https:');
            }
            if (app === 'customer') expect(csp['frame-src']).toEqual(expect.arrayContaining(['https://maps.google.com']));
            if (app === 'business') expect(csp['script-src']).toContain('https://maps.googleapis.com');
        });
    });
}
