import { describe, it, expect } from 'vitest';
import { formatMoney, currencySymbol } from './currency';

describe('formatMoney', () => {
    it('writes the symbol, a space, and the amount — cents only when there are some', () => {
        expect(formatMoney(240)).toBe('N$ 240');
        expect(formatMoney(240, 'NAD')).toBe('N$ 240');
        expect(formatMoney(856.5, 'NAD')).toBe('N$ 856.50');
        expect(formatMoney(0, 'ZAR')).toBe('R 0');
        expect(formatMoney(12, 'USD')).toBe('$ 12');
    });

    it('rounds to the cent (float sums) and groups thousands as the device does', () => {
        expect(formatMoney(120.1 + 120.2)).toBe('N$ 240.30');
        expect(formatMoney(239.999999)).toBe('N$ 240');
        expect(formatMoney(1998.5)).toBe(`N$ ${(1998.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        expect(formatMoney(12000)).toBe(`N$ ${(12000).toLocaleString()}`);
    });

    it('reads a missing or broken amount as 0', () => {
        expect(formatMoney(undefined)).toBe('N$ 0');
        expect(formatMoney(null)).toBe('N$ 0');
        expect(formatMoney('abc')).toBe('N$ 0');
        expect(formatMoney('45')).toBe('N$ 45');
    });

    it('falls back to the code, then N$', () => {
        expect(currencySymbol('xyz')).toBe('xyz');
        expect(currencySymbol()).toBe('N$');
    });
});
