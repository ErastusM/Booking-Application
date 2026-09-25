// 24-hour clock display. Bookplus reads every time of day as "HH:mm" ("09:30",
// "14:00"), never 12-hour AM/PM. Appointment times are already stored and shown
// as "HH:mm" strings; this covers the times the app derives from a timestamp.

const pad = (n) => String(n).padStart(2, '0');

// A Date / timestamp → its local wall-clock "HH:mm" (message times). Built from
// the local getters rather than toLocaleTimeString, which prints "02:30 PM" on
// any device (or 'en-US' option) that defaults to 12-hour.
export const fmtClock = (value) => {
    if (value == null || value === '') return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
