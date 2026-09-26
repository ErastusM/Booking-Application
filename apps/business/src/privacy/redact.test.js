/**
 * The browser scrubber (@bookplus/api-client redact) must agree with the API's
 * (apps/api/src/utils/redact.js): both run the same vector table. It guards the
 * crash reporter and the analytics path in BOTH apps.
 */
import { describe, it, expect } from 'vitest';
import { scrubUrl, scrubText, routeTemplate } from '@bookplus/api-client';
import vectors from '../../../api/src/tests/fixtures/redactVectors.json';

describe('browser redaction', () => {
    it.each(vectors.urls)('%s', (input, expected) => {
        expect(scrubUrl(input)).toBe(expected);
    });

    it('scrubs tokens quoted inside error messages and stacks', () => {
        const out = scrubText('fetch failed: https://business.bookplus.pro/accept-invite?token=SECRETVALUE at x (/manage/SECRETVALUE)');
        expect(out).not.toContain('SECRETVALUE');
    });

    it('turns a guest manage path into its route template for analytics', () => {
        expect(routeTemplate('/manage/0b8a3c1e-2f4d-4c6a-9e7b-1a2b3c4d5e6f')).toBe('/manage/:token');
        expect(routeTemplate('/reset-password?token=abc')).toBe('/reset-password');
        expect(routeTemplate('/providers/64b7f0c2a1b2c3d4e5f60718')).toBe('/providers/64b7f0c2a1b2c3d4e5f60718');
    });
});
