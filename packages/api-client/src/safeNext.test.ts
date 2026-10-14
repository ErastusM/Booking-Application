import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

const O = 'https://www.bookplus.pro';

describe('safeNext', () => {
    it.each([
        ['/dashboard', '/dashboard'],
        ['/book-appointment?providerId=42', '/book-appointment?providerId=42'],
        ['/appointments?tab=upcoming#today', '/appointments?tab=upcoming#today'],
    ])('keeps the relative path %s', (raw, out) => expect(safeNext(raw, O)).toBe(out));

    it.each([
        null, undefined, '', 'dashboard', 'https://evil.com', '//evil.com', '///evil.com',
        '/\\evil.com', '/\\/evil.com', '\\\\evil.com', 'javascript:alert(1)', '/\n//evil.com',
        '/login', '/login?next=/appointments', '/accept-invite?token=abc', '/reset-password?token=abc', '/verify-email',
    ])('refuses %p', (raw) => expect(safeNext(raw, O)).toBeNull());
});
