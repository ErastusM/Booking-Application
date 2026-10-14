// Formatting shared by the admin console's sections.

/** N$1,234.50 from a rand amount (bookings, wallets). */
export const money = (n) => `N$${Number(n || 0).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** N$1,235 — for large totals where cents are noise. */
export const money0 = (n) => `N$${Number(n || 0).toLocaleString('en-NA', { maximumFractionDigits: 0 })}`;
/** N$1,234.50 from cents (online payments). */
export const cents = (c) => money((c || 0) / 100);
export const count = (n) => Number(n || 0).toLocaleString('en-NA');
export const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

const isoToday = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Today", "Tomorrow", "Yesterday" or "Fri 16 Oct" for a booking's date. */
export const bookingDay = (date) => {
    const iso = String(date || '').slice(0, 10);
    if (!iso) return '';
    if (iso === isoToday()) return 'Today';
    if (iso === isoToday(1)) return 'Tomorrow';
    if (iso === isoToday(-1)) return 'Yesterday';
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** 16 Oct 2026 */
export const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const BOOKING_STATUS = {
    pending: ['Pending', 'warn'],
    confirmed: ['Confirmed', 'info'],
    completed: ['Completed', 'ok'],
    cancelled: ['Cancelled', undefined],
    'no-show': ['No-show', 'bad'],
};
