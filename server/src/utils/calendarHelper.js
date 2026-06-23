// Calendar helpers: build "Add to Google Calendar" links and downloadable .ics
// attachments for appointment emails. No Google login or API credentials needed —
// the link pre-fills Google Calendar and the .ics works with Apple/Outlook/Google.
//
// Times are floating local wall-clock (Bookplus operates in Africa/Windhoek, UTC+2,
// no DST). appointmentDate is stored at UTC-midnight of the booked day and
// start/end are local "HH:MM", so we stamp from the UTC date parts + the local
// time. This stays correct regardless of the server's own timezone and matches the
// existing confirmation-email calendar link.

const pad = (n) => String(n).padStart(2, '0');

// Floating local stamp "YYYYMMDDTHHMMSS" (no Z) from a booked day + "HH:MM".
const localStamp = (appointmentDate, hhmm) => {
    const d = new Date(appointmentDate);
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(h || 0)}${pad(m || 0)}00`;
};

// UTC stamp with trailing Z, for DTSTAMP (the moment the event file was created).
const utcStamp = (date) => {
    const d = date || new Date();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

// "Add to Google Calendar" template URL.
const googleCalendarUrl = ({ title, appointmentDate, startTime, endTime, details, location }) => {
    const dates = `${localStamp(appointmentDate, startTime)}/${localStamp(appointmentDate, endTime || startTime)}`;
    const params = [
        `text=${encodeURIComponent(title || 'Appointment')}`,
        `dates=${dates}`,
        details ? `details=${encodeURIComponent(details)}` : '',
        location ? `location=${encodeURIComponent(location)}` : '',
    ].filter(Boolean).join('&');
    return `https://www.google.com/calendar/render?action=TEMPLATE&${params}`;
};

// Escape a text value per RFC 5545 §3.3.11.
const icsEscape = (s) => String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// Fold lines to ≤75 octets (RFC 5545 §3.1): continuation lines start with a space.
const fold = (line) => {
    if (line.length <= 75) return line;
    const out = [line.slice(0, 75)];
    let i = 75;
    while (i < line.length) { out.push(' ' + line.slice(i, i + 74)); i += 74; }
    return out.join('\r\n');
};

// Build a single-event .ics document string.
const buildIcs = ({ uid, title, appointmentDate, startTime, endTime, description, location, status, sequence }) => {
    const cancelled = String(status).toUpperCase() === 'CANCELLED';
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Bookplus//Booking//EN',
        'CALSCALE:GREGORIAN',
        `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${utcStamp()}`,
        `DTSTART:${localStamp(appointmentDate, startTime)}`,
        `DTEND:${localStamp(appointmentDate, endTime || startTime)}`,
        `SUMMARY:${icsEscape(title || 'Appointment')}`,
        description ? `DESCRIPTION:${icsEscape(description)}` : '',
        location ? `LOCATION:${icsEscape(location)}` : '',
        `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
        `SEQUENCE:${Number.isFinite(sequence) ? sequence : 0}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ].filter(Boolean);
    return lines.map(fold).join('\r\n') + '\r\n';
};

// Convenience: from a (possibly populated) appointment doc, produce both a Google
// Calendar link and an .ics string. `title`/`location`/`status`/`sequence` optional.
const appointmentCalendar = (appt, { title, description, location, status, sequence } = {}) => {
    const t = title || appt.service?.name || 'Appointment';
    const desc = description || 'Booked via Bookplus';
    return {
        gcalUrl: googleCalendarUrl({
            title: t, appointmentDate: appt.appointmentDate, startTime: appt.startTime,
            endTime: appt.endTime, details: desc, location,
        }),
        ics: buildIcs({
            uid: `${appt._id}@bookplus`, title: t, appointmentDate: appt.appointmentDate,
            startTime: appt.startTime, endTime: appt.endTime, description: desc, location, status, sequence,
        }),
    };
};

module.exports = { googleCalendarUrl, buildIcs, appointmentCalendar, localStamp, utcStamp };
