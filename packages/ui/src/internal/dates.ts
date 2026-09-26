// Local-date helpers. Values travel as 'YYYY-MM-DD' strings (what <input
// type="date"> produced) and are only ever turned into local-midnight Dates, so
// there is no UTC off-by-one near midnight.

const pad = (n: number) => String(n).padStart(2, '0');

export const toKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseKey = (s: string | null | undefined): Date | null => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
};

export const todayKey = (): string => toKey(new Date());

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Month arithmetic that clamps the day (Jan 31 + 1 month = Feb 28/29).
export const addMonths = (d: Date, n: number): Date => {
    const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
};

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

export const monthKey = (d: Date): number => d.getFullYear() * 12 + d.getMonth();

// "Tue, Aug 5, 2025" — the app's own en-US date style.
export const formatDateLong = (s: string): string => {
    const d = parseKey(s);
    return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : s;
};

// ── Times: 'HH:MM', 24-hour ──

export const toMinutes = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(s);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
};

export const fromMinutes = (total: number): string => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
