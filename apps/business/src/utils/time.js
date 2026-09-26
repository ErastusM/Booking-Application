// 24-hour clock display — the one place the business app turns a time of day
// into text. Bookplus reads every time as "HH:mm" ("09:30", "14:00", ranges
// "14:00 – 15:00"), never 12-hour AM/PM, whatever locale the device is set to.
//
// Display only. Stored and sent times are already "HH:mm" strings and keep their
// own data helpers (bookingSlots.fmtMinutes, the calendars' timeOf), so a request
// payload never changes shape because of how a label reads.

const pad = (n) => String(n).padStart(2, '0');

// Minutes-from-midnight → "HH:mm". Wraps at 24 h: a booking that runs to
// midnight (endMin 1440) ends at "00:00", not "24:00".
export const fmtHM = (mins) => {
    const m = ((Math.round(Number(mins) || 0) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

// Start/end minutes → "14:00 – 15:00".
export const fmtHMRange = (startMin, endMin) => `${fmtHM(startMin)} – ${fmtHM(endMin)}`;

// A Date / timestamp → its local wall-clock "HH:mm" (message and chat times).
// Built from the local getters rather than toLocaleTimeString, which prints
// "02:30 PM" on any device whose locale defaults to 12-hour.
export const fmtClock = (value) => {
    if (value == null || value === '') return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
