/**
 * Calendar times must be unambiguous instants.
 *
 * Reported: a booking made for 10:00 produced a reminder whose "Add to Calendar"
 * chip read "12:00 – 12:30 (CAT)" — two hours late. Cause: the Google Calendar
 * `dates=` param and the .ics DTSTART carried a FLOATING stamp (no Z, no TZID),
 * and Google reads a zone-less value as UTC. 10:00 was therefore treated as
 * 10:00 UTC and re-rendered as 12:00 for a CAT (UTC+2) reader.
 */
const { googleCalendarUrl, buildIcs, utcStampFromLocal } = require('../../utils/calendarHelper');

// appointmentDate is stored at UTC-midnight of the booked day.
const DAY = new Date('2026-07-22T00:00:00.000Z');

describe('booked wall-clock times convert to real UTC instants', () => {
    it('maps 10:00 Namibian time to 08:00Z — the exact case from the report', () => {
        expect(utcStampFromLocal(DAY, '10:00')).toBe('20260722T080000Z');
    });

    it('always emits a Z-terminated instant, never a floating stamp', () => {
        const stamp = utcStampFromLocal(DAY, '10:00');
        expect(stamp.endsWith('Z')).toBe(true);
        expect(stamp).not.toBe('20260722T100000'); // the old, ambiguous form
    });

    it('handles a time that crosses back over midnight UTC', () => {
        // 01:00 CAT is 23:00Z on the PREVIOUS day.
        expect(utcStampFromLocal(DAY, '01:00')).toBe('20260721T230000Z');
    });

    it('google calendar link carries UTC instants, so CAT readers see 10:00', () => {
        const url = googleCalendarUrl({
            title: 'Trim & beard', appointmentDate: DAY, startTime: '10:00', endTime: '10:30',
        });
        expect(url).toContain('dates=20260722T080000Z/20260722T083000Z');
        // The old floating form would have shifted the reader +2h.
        expect(url).not.toContain('20260722T100000/');
    });

    it('ics DTSTART/DTEND carry UTC instants', () => {
        const ics = buildIcs({
            uid: 'x@bookplus', title: 'Trim & beard',
            appointmentDate: DAY, startTime: '10:00', endTime: '10:30',
        });
        expect(ics).toContain('DTSTART:20260722T080000Z');
        expect(ics).toContain('DTEND:20260722T083000Z');
        expect(ics).not.toContain('DTSTART:20260722T100000\r\n');
    });
});
