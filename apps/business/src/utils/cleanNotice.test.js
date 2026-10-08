import { describe, it, expect } from 'vitest';
import { cleanNotice, stripEmoji } from './cleanNotice';

describe('cleanNotice', () => {
    it('turns old emoji notifications into the new wording', () => {
        expect(cleanNotice('🎉 New booking — Aidan booked a Haircut (N$150.00) on Oct 7 at 13:00'))
            .toBe('New booking: Aidan booked a Haircut (N$150.00) on Oct 7 at 13:00');
        expect(cleanNotice('❌ Cancelled — Adriel cancelled their Kids cut on Oct 8 at 10:00. The slot is free again.'))
            .toBe('Cancelled: Adriel cancelled their Kids cut on Oct 8 at 10:00. The slot is free again.');
        expect(cleanNotice('🔁 Slot refilled — Albon was booked from the waiting list.')).toBe('Slot refilled: Albon was booked from the waiting list.');
        expect(cleanNotice('✅ You’re booked for a Beard trim with Vido on Oct 9 at 09:00.')).toBe('You’re booked for a Beard trim with Vido on Oct 9 at 09:00.');
        expect(cleanNotice('⚠️ 4 booking attempts were turned away in the last hour — most hit “Closed”.'))
            .toBe('4 booking attempts were turned away in the last hour — most hit “Closed”.');
    });

    it('leaves new messages and dashes in plain sentences alone', () => {
        expect(cleanNotice('New booking: Ana booked a Haircut')).toBe('New booking: Ana booked a Haircut');
        expect(cleanNotice('Your Haircut on Thursday was cancelled — Moses is away.')).toBe('Your Haircut on Thursday was cancelled — Moses is away.');
        expect(cleanNotice(null)).toBe('');
    });

    it('removes whole emoji sequences but keeps typographic marks', () => {
        expect(stripEmoji('Team 👨‍👩‍👧 from 🇳🇦 👍🏽 1️⃣')).toBe('Team  from   1');
        expect(stripEmoji('★ 4.8 ✓ done × © Bookplus N$ 120')).toBe('★ 4.8 ✓ done × © Bookplus N$ 120');
    });
});
