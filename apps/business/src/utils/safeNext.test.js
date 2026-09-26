import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

const O = 'https://business.bookplus.pro';

describe('safeNext', () => {
    it.each([
        ['/dashboard', '/dashboard'],
        ['/team?member=42', '/team?member=42'],
        ['/dashboard?tab=calendar#today', '/dashboard?tab=calendar#today'],
    ])('keeps the relative path %s', (raw, out) => expect(safeNext(raw, O)).toBe(out));

    it.each([
        null, undefined, '', 'dashboard', 'https://evil.com', '//evil.com', '///evil.com',
        '/\\evil.com', '/\\/evil.com', '\\\\evil.com', 'javascript:alert(1)', '/%0a//evil.com'.replace('%0a', '\n'),
        '/login', '/login?next=/team', '/accept-invite?token=abc', '/reset-password?token=abc', '/verify-email',
    ])('refuses %p', (raw) => expect(safeNext(raw, O)).toBeNull());
});
