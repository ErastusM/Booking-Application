import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import useApptDrag from './calendar/useApptDrag';
import ConflictSheet from './calendar/ConflictSheet';

// Bookplus bespoke calendar grid — a hand-built Fresha-style time grid that
// replaces FullCalendar for the Day / 3-Day / Week views. One column per day,
// a shared time axis, staff-coloured appointment cards with a colour rail, a
// recurring ⟳ badge, hatched off-hours, grey blocked time, and a live now-line.
// Tapping a card calls onEventClick(rawAppointment) — the dashboard's detail
// sheet handles everything after that. The per-staff "Staff" view still lives
// in StaffLanesDay; this component owns the day-columns views only.
//
// e2e contract preserved: appointment cards carry `.fc-event-appt`,
// `.fc-event-appt-client`, and `.fc-event-appt-staff` so staff-lanes.spec.cjs
// keeps asserting against real content.

const HOUR_PX = 76;               // matches the approved prototype (roomy slots)
const GUTTER_W = 44;
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => dateKey(a) === dateKey(b);
const startOfWeek = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };
const toDateStr = (v) => {
    if (!v) return null;
    if (typeof v === 'string' && v.length >= 10) return v.slice(0, 10);
    return dateKey(new Date(v));
};
const minutesOf = (t) => { const [h = 0, m = 0] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const timeOf = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const f12 = (mins) => {
    let h = Math.floor(mins / 60); const mm = mins % 60; const ap = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return `${h}${mm ? ':' + pad(mm) : ''} ${ap}`;
};
const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Soft, theme-safe tint from a staff colour hex → { bg, rail }. The tint is an
// alpha wash so it reads on light and dark grounds; ink stays neutral for
// contrast, letting the rail + wash carry the staff identity (like the proto).
const hexToRgb = (hex) => {
    // Only real hex colours parse. Non-hex values (e.g. a CSS var like
    // 'var(--gold)', which owner appointments use) must return null so the
    // caller falls back — otherwise parseInt('va',16) yields NaN and the card
    // gets an invalid `rgba(NaN,…)` background that renders as light paper
    // (invisible in dark mode).
    const h = String(hex || '').replace('#', '').trim();
    if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null;
    if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};
/**
 * How an appointment card should read at a glance, given the clock.
 *
 * The FullCalendar-era calendar coloured cards by STATUS, so an appointment went
 * blue → green on its own once the auto-complete job flipped it to `completed`
 * after its end time. Colouring by staff member (which is what tells you whose
 * column a booking is in) lost that signal entirely. This restores it without
 * giving up the staff colours: a finished appointment keeps its owner's hue but
 * recedes, and carries a small mark saying what it is.
 *
 * "Elapsed" is time-based rather than status-based on purpose — the auto-complete
 * job runs on an interval, so a just-finished booking should look finished
 * immediately rather than whenever the cron next fires.
 */
export const cardState = ({ status, endMin, day, today }) => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const nowMin = today.getHours() * 60 + today.getMinutes();
    const elapsed = dayStart < todayStart || (dayStart.getTime() === todayStart.getTime() && endMin <= nowMin);

    const done = status === 'completed';
    const pending = status === 'pending';
    const noShow = status === 'no-show';

    return {
        // Faded once it is behind you, or explicitly finished.
        recede: done || noShow || elapsed,
        pending,
        // ✓ finished · ✗ no-show · ◦ awaiting confirmation. Deliberately quiet:
        // the mark is a supplement to the fade, not a second loud signal.
        mark: done ? '✓' : noShow ? '✕' : pending ? '◦' : '',
        markTitle: done ? 'Completed' : noShow ? 'No-show' : pending ? 'Awaiting confirmation' : '',
    };
};

const staffPalette = (hex) => {
    const rgb = hexToRgb(hex);
    const { r, g, b } = rgb || { r: 240, g: 62, b: 22 };
    const rail = rgb ? hex : 'var(--gold)';
    // Lay the staff wash over an OPAQUE var(--card-bg) so the card is always the
    // theme's own lightness (light in light mode, dark in dark mode) — the tint
    // only colours it, it can never flip the card to the wrong ground.
    return { bg: `linear-gradient(0deg, rgba(${r},${g},${b},0.20), rgba(${r},${g},${b},0.20)), var(--card-bg)`, rail };
};

// Overlap layout: side-by-side columns for events that share time (greedy),
// mirrors FullCalendar's slotEventOverlap=false.
const layoutOverlaps = (events) => {
    const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const clusters = [];
    let cluster = null; let clusterEnd = -1;
    sorted.forEach((ev) => {
        if (!cluster || ev.startMin >= clusterEnd) { cluster = []; clusters.push(cluster); clusterEnd = ev.endMin; }
        else clusterEnd = Math.max(clusterEnd, ev.endMin);
        cluster.push(ev);
    });
    clusters.forEach((cl) => {
        const colEnds = [];
        cl.forEach((ev) => {
            let col = colEnds.findIndex((end) => end <= ev.startMin);
            if (col === -1) { col = colEnds.length; colEnds.push(ev.endMin); }
            else colEnds[col] = ev.endMin;
            ev.col = col;
        });
        cl.forEach((ev) => { ev.cols = colEnds.length; });
    });
    return sorted;
};

const clientNameOf = (a) => a.walkInName || a.guestName || a.customer?.name || a.customerName || 'Client';
const serviceNameOf = (a) => a.service?.name
    || a.services?.[0]?.service?.name || a.services?.[0]?.name
    || a.serviceName || 'Appointment';

const navBtn = {
    width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px',
    color: 'var(--charcoal)', cursor: 'pointer',
};

const CalendarGrid = ({
    view = '3day',           // 'day' | '3day' | 'week'
    date,                    // anchor Date
    onDateChange,            // (Date) => void — prev/next/today
    onViewChange,            // (view) => void — Today also snaps back to the Day view
    appointments = [],       // raw appointments (any day)
    blockedTimes = [],       // raw blocked times (any day)
    teamMembers = [],        // roster (for staff colour + name resolution)
    ownerName,               // labels the owner/unassigned staff
    staffFilter = 'all',     // 'all' | 'unassigned' | teamMember _id
    availability,            // business hours { monday: {enabled, slots:[{start,end}]}, … }
    height,                  // px — measured fill height from the dashboard
    headerControl,           // optional node rendered in the header row (e.g. the view switcher)
    onEventClick,            // (rawAppointment) => void
    onBlockClick,            // (rawBlockedTime) => void
    onSlotClick,             // ({date, startTime, endTime}) => void
    onReschedule,            // ({moves, mode}) => Promise — drag/resize commit
}) => {
    const anchor = date instanceof Date ? date : new Date();
    const cols = view === 'day' ? 1 : view === 'week' ? 7 : 3;
    const firstDay = view === 'week' ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const days = useMemo(() => Array.from({ length: cols }, (_, i) => addDays(firstDay, i)), [dateKey(firstDay), cols]);
    const today = new Date();

    // Re-render each minute so the now-line advances.
    const [, tick] = useState(0);
    const showsToday = days.some((d) => sameDay(d, today));
    useEffect(() => {
        if (!showsToday) return undefined;
        const t = setInterval(() => tick((n) => n + 1), 60000);
        return () => clearInterval(t);
    }, [showsToday]);

    const rosterIds = useMemo(() => new Set(teamMembers.map((m) => String(m._id))), [teamMembers]);
    const memberById = useMemo(() => {
        const map = {};
        teamMembers.forEach((m) => { map[String(m._id)] = m; });
        return map;
    }, [teamMembers]);

    const matchesStaff = (tmId) => {
        if (staffFilter === 'all') return true;
        if (staffFilter === 'unassigned') return !(tmId && rosterIds.has(tmId));
        return tmId === String(staffFilter);
    };

    // Build per-day buckets of appointments + blocks within the visible window.
    const dayKeys = days.map(dateKey);
    const perDay = useMemo(() => {
        const buckets = {};
        dayKeys.forEach((k) => { buckets[k] = { appts: [], blocks: [] }; });
        appointments.forEach((a) => {
            if (a.status === 'cancelled') return;
            const k = toDateStr(a.appointmentDate);
            if (!buckets[k]) return;
            const tmId = String(a.teamMember?._id || a.teamMember || '');
            if (!matchesStaff(tmId)) return;
            const startMin = minutesOf(a.startTime);
            let endMin = minutesOf(a.endTime || '');
            if (!a.endTime) endMin = startMin + 30;
            else if (endMin <= startMin) endMin = 24 * 60;
            endMin = Math.max(endMin, startMin + 15);
            const member = tmId && memberById[tmId] ? memberById[tmId] : null;
            buckets[k].appts.push({
                raw: a, startMin, endMin,
                client: clientNameOf(a),
                service: serviceNameOf(a),
                staffName: member?.name || (tmId ? '' : (ownerName ? ownerName.split(' ')[0] : '')),
                staffColor: member?.color || 'var(--gold)',
                isRecurring: !!a.isRecurring,
                status: a.status,
            });
        });
        blockedTimes.forEach((b) => {
            const k = toDateStr(b.date);
            if (!buckets[k]) return;
            const tmId = String(b.teamMember?._id || b.teamMember || '');
            // Business-wide blocks show always; member blocks respect the filter.
            if (tmId && !matchesStaff(tmId)) return;
            const startMin = minutesOf(b.startTime);
            const endMin = Math.max(minutesOf(b.endTime), startMin + 15);
            buckets[k].blocks.push({ raw: b, startMin, endMin, label: b.reason || b.title || 'Blocked', isRecurring: !!b.isRecurring });
        });
        Object.values(buckets).forEach((bk) => { bk.appts = layoutOverlaps(bk.appts); });
        return buckets;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointments, blockedTimes, dayKeys.join(','), staffFilter, teamMembers]);

    // The grid spans the FULL day (00:00–24:00) and scrolls on its time axis —
    // the whole day is reachable, nothing is clipped off the top or bottom. We
    // still find the first "interesting" minute (business open or earliest
    // booking across the shown days) so the view opens scrolled to the day's
    // content instead of the empty pre-dawn hours.
    const winStart = 0;
    const winEnd = 24 * 60;
    const firstContentMin = useMemo(() => {
        let first = null;
        const consider = (v) => { first = first == null ? v : Math.min(first, v); };
        days.forEach((d) => {
            const cfg = availability?.[DAY_NAMES[d.getDay()]];
            (cfg?.enabled && Array.isArray(cfg.slots) ? cfg.slots : [])
                .filter((s) => s?.start && s?.end)
                .forEach((s) => consider(minutesOf(s.start)));
        });
        dayKeys.forEach((k) => {
            (perDay[k]?.appts || []).forEach((e) => consider(e.startMin));
            (perDay[k]?.blocks || []).forEach((e) => consider(e.startMin));
        });
        return first == null ? 8 * 60 : Math.max(0, Math.floor(first / 60) * 60);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dayKeys.join(','), perDay, availability]);

    const bodyH = ((winEnd - winStart) / 60) * HOUR_PX;
    const pxOf = (mins) => ((mins - winStart) / 60) * HOUR_PX;

    // Off-hours (non-working) intervals per day, for hatching.
    const offIntervalsOf = (d) => {
        // Availability arrives a moment after the grid first paints. Until it
        // does we know NOTHING about the opening hours — and "nothing known"
        // must not render as "closed all day". It used to: the whole three-day
        // grid came up solid hatching and sat there looking shut until the
        // request landed, which is why the calendar felt slow to open even
        // though it had already drawn.
        if (!availability) return [];
        const cfg = availability[DAY_NAMES[d.getDay()]];
        const slots = (cfg?.enabled && Array.isArray(cfg.slots) ? cfg.slots : []).filter((s) => s?.start && s?.end);
        if (!slots.length) return [[winStart, winEnd]];
        const sorted = slots.map((s) => [minutesOf(s.start), minutesOf(s.end)]).sort((a, b) => a[0] - b[0]);
        const out = []; let cursor = winStart;
        sorted.forEach(([s, e]) => { if (s > cursor) out.push([cursor, Math.min(s, winEnd)]); cursor = Math.max(cursor, e); });
        if (cursor < winEnd) out.push([cursor, winEnd]);
        return out.filter(([s, e]) => e > s);
    };

    const hourMarks = [];
    // Exclude the 24:00 boundary so the gutter doesn't print a misleading
    // "12 PM" at the very bottom (midnight of the next day).
    for (let m = winStart; m < winEnd; m += 60) hourMarks.push(m);

    const nowMin = today.getHours() * 60 + today.getMinutes();

    // Range label for the header.
    const rangeLabel = (() => {
        const s = days[0]; const e = days[days.length - 1];
        if (cols === 1) return `${DOW_SHORT[(s.getDay() + 6) % 7]} ${s.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
        if (s.getMonth() === e.getMonth()) return `${s.getDate()} – ${e.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
        return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
    })();

    const bodyRef = useRef(null);
    const isTodayInView = showsToday;
    // Open the scroll at the day's first content (business open / earliest
    // booking), a touch above it, so the schedule is visible immediately while
    // the full 24 h stays scrollable above and below.
    //
    // Retried until the scroller HAS LAYOUT. The dashboard sizes the calendar
    // frame after mount and re-measures as late content above it lands (the
    // staff filter chips, setup cards). A scrollTop assigned while
    // clientHeight is 0 is silently ignored by the browser, so the one-shot
    // version of this effect lost the race once that late reflow became the
    // norm — the calendar then sat at 12 AM and every open needed a manual
    // scroll down to working hours.
    useEffect(() => {
        let cancelled = false;
        const apply = (attemptsLeft) => {
            if (cancelled) return;
            const el = bodyRef.current;
            if (el && el.clientHeight > 0) {
                el.scrollTop = Math.max(0, (firstContentMin / 60) * HOUR_PX - 12);
                return;
            }
            if (attemptsLeft > 0) requestAnimationFrame(() => apply(attemptsLeft - 1));
        };
        apply(120); // ~2s of frames — outlasts the dashboard's staged re-measures
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, dateKey(firstDay), firstContentMin]);

    const shift = (delta) => onDateChange && onDateChange(addDays(anchor, delta * cols));

    const colTemplate = `${GUTTER_W}px repeat(${cols}, minmax(0, 1fr))`;

    const handleColClick = (d, colEl) => (e) => {
        if (!onSlotClick || !colEl) return;
        const y = e.clientY - colEl.getBoundingClientRect().top;
        const raw = winStart + (y / HOUR_PX) * 60;
        const startMin = Math.max(winStart, Math.min(winEnd - 15, Math.floor(raw / 15) * 15));
        onSlotClick({ date: dateKey(d), startTime: timeOf(startMin), endTime: timeOf(Math.min(24 * 60 - 1, startMin + 60)) });
    };
    const colRefs = useRef({});

    // ── Drag to reschedule ──────────────────────────────────────────────────
    // The grid's bookings, flattened into the shape the shared gesture speaks:
    // minutes rather than clock strings, and a staffKey so only the same team
    // member's bookings can collide.
    const dragItems = useMemo(() => {
        const out = [];
        days.forEach((d) => {
            const k = dateKey(d);
            (perDay[k]?.appts || []).forEach((ev) => {
                const st = cardState({ status: ev.status, endMin: ev.endMin, day: d, today });
                out.push({
                    id: String(ev.raw._id),
                    dateKey: k,
                    startMin: ev.startMin,
                    endMin: ev.endMin,
                    staffKey: String(ev.raw.teamMember?._id || ev.raw.teamMember || ''),
                    // Finished work can neither be picked up nor shoved aside.
                    locked: st.recede,
                    label: ev.client,
                    raw: ev.raw,
                });
            });
        });
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dayKeys.join(','), perDay]);

    const commitMoves = useCallback(async ({ moves, mode }) => {
        if (!onReschedule) return;
        await onReschedule({
            mode,
            moves: moves.map((m) => ({
                id: m.id,
                appointmentDate: m.dateKey,
                startTime: timeOf(m.startMin),
                endTime: timeOf(m.endMin),
            })),
        });
    }, [onReschedule]);

    const dnd = useApptDrag({
        scrollerRef: bodyRef,
        hourPx: HOUR_PX,
        items: dragItems,
        columns: dayKeys,
        fmt: f12,
        enabled: !!onReschedule,
        onCommit: commitMoves,
        onTap: (id, why) => {
            if (why === 'locked') return;
            const it = dragItems.find((x) => x.id === id);
            if (it && onEventClick) onEventClick(it.raw);
        },
    });

    return (
        // position:relative so the conflict sheet can anchor to the calendar
        // rather than the page — it reads as a sheet over the grid it concerns.
        <div style={{ height: height || 640, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', minHeight: 0, position: 'relative' }}>
            {/* Single control strip: prev / next / range · view switcher · today */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <button type="button" aria-label="Previous" onClick={() => shift(-1)} style={navBtn}><ChevronLeft size={17} /></button>
                <button type="button" aria-label="Next" onClick={() => shift(1)} style={navBtn}><ChevronRight size={17} /></button>
                <span style={{ flex: 1, minWidth: 0, marginLeft: '0.15rem', fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rangeLabel}
                </span>
                {headerControl}
                <button
                    type="button"
                    // "Today" means "put me back where I start the day": today's date
                    // AND the single-day view. Setting only the date made the button
                    // look broken in the 3-Day and Week views — today is already on
                    // screen there, so nothing moved when you pressed it.
                    onClick={() => {
                        onDateChange && onDateChange(new Date());
                        onViewChange && onViewChange('day');
                    }}
                    // Only inert when it genuinely has nothing left to do: already the
                    // Day view, already today.
                    disabled={isTodayInView && cols === 1}
                    style={{ ...navBtn, width: 'auto', padding: '0 0.7rem', fontSize: '0.78rem', fontWeight: 600 }}
                >
                    Today
                </button>
            </div>

            {/* Day-of-week header row */}
            <div style={{ display: 'grid', gridTemplateColumns: colTemplate, background: 'var(--card-bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                    <span style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--surface-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.6rem', fontWeight: 600, display: 'grid', placeItems: 'center' }}>All</span>
                </div>
                {days.map((d) => {
                    const sel = sameDay(d, today);
                    return (
                        <div key={dateKey(d)} style={{ padding: '0.4rem 0 0.35rem', textAlign: 'center' }}>
                            <div style={{ margin: '0 auto', width: '28px', height: '28px', lineHeight: '28px', borderRadius: '50%', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums', background: sel ? 'var(--gold)' : 'transparent', color: sel ? '#fff' : 'var(--charcoal)' }}>
                                {d.getDate()}
                            </div>
                            <div style={{ fontSize: '0.55rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: sel ? 'var(--gold-dark)' : 'var(--text-muted)', marginTop: '0.1rem' }}>
                                {DOW_SHORT[(d.getDay() + 6) % 7]}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Scrollable grid body.
                overscrollBehavior:'none' is what stops the calendar "moving": without it
                iOS applies its elastic bounce when you drag past the first or last hour,
                pulling the grid away from the frame edge and exposing a gap above or
                below it. `none` also prevents the drag chaining to the page behind. */}
            <div
                ref={bodyRef}
                onPointerMove={dnd.onPointerMove}
                onPointerUp={dnd.onPointerUp}
                onPointerCancel={dnd.onPointerUp}
                style={{
                    flex: 1, minHeight: 0, overflow: dnd.drag ? 'hidden' : 'auto',
                    overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch',
                }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: colTemplate, position: 'relative' }}>
                    {/* Time gutter */}
                    <div style={{ position: 'relative', height: `${bodyH}px`, borderRight: '1px solid var(--border)' }}>
                        {hourMarks.map((m) => (
                            <span key={m} className="tnum" style={{ position: 'absolute', top: `${pxOf(m) - 6}px`, right: '6px', fontSize: '0.58rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                {m === winStart ? '' : f12(m)}
                            </span>
                        ))}
                    </div>

                    {/* Day columns */}
                    {days.map((d, colIdx) => {
                        const k = dateKey(d);
                        const bucket = perDay[k] || { appts: [], blocks: [] };
                        const sel = sameDay(d, today);
                        return (
                            <div
                                key={k}
                                ref={(el) => { colRefs.current[k] = el; }}
                                // One column carries the marker the drag uses to measure a
                                // column's width; the grid itself can't, because it also
                                // contains the time gutter.
                                {...(colIdx === 0 ? { 'data-col-track': '' } : {})}
                                onClick={(e) => { if (dnd.shouldIgnoreClick()) return; handleColClick(d, colRefs.current[k])(e); }}
                                style={{
                                    position: 'relative', height: `${bodyH}px`, borderLeft: '1px solid var(--border)',
                                    cursor: onSlotClick ? 'pointer' : 'default',
                                    background: sel ? 'rgba(240,62,22,0.04)' : 'transparent',
                                    backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)`,
                                }}
                            >
                                {/* Off-hours hatch */}
                                {offIntervalsOf(d).map(([s, e], i) => (
                                    <div key={`off_${i}`} aria-hidden="true" className="staff-lane-offhours" style={{ position: 'absolute', top: `${pxOf(s)}px`, height: `${((e - s) / 60) * HOUR_PX}px`, left: 0, right: 0, pointerEvents: 'none' }} />
                                ))}

                                {/* Blocked time */}
                                {bucket.blocks.map((blk, i) => (
                                    <div
                                        key={`blk_${blk.raw._id}_${i}`}
                                        onClick={(e) => { e.stopPropagation(); onBlockClick && onBlockClick(blk.raw); }}
                                        title={blk.label}
                                        style={{
                                            position: 'absolute', top: `${pxOf(blk.startMin)}px`, height: `${((blk.endMin - blk.startMin) / 60) * HOUR_PX}px`,
                                            left: '2px', right: '2px', zIndex: 1, overflow: 'hidden',
                                            // Neutral wash over the theme surface so it reads as muted/greyed in
                                            // both light and dark mode (was hardcoded light paper).
                                            background: 'linear-gradient(0deg, rgba(140,143,142,0.16), rgba(140,143,142,0.16)), var(--card-bg)',
                                            border: '1px solid var(--border)', borderLeft: '3px solid var(--text-muted)', borderRadius: '8px',
                                            color: 'var(--charcoal)', fontSize: '0.68rem', fontWeight: 600, padding: '3px 8px', cursor: 'pointer',
                                        }}
                                    >
                                        {blk.isRecurring && <span aria-hidden="true" style={{ position: 'absolute', top: '2px', right: '4px', fontSize: '0.66rem', opacity: 0.6 }}>⟳</span>}
                                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '10px' }}>{f12(blk.startMin)} – {f12(blk.endMin)}</span>
                                        <span style={{ opacity: 0.85 }}>{blk.label}</span>
                                    </div>
                                ))}

                                {/* Appointments */}
                                {bucket.appts.map((ev) => {
                                    const pal = staffPalette(ev.staffColor);
                                    const st = cardState({ status: ev.status, endMin: ev.endMin, day: d, today });
                                    const dim = st.pending;

                                    const item = dragItems.find((x) => x.id === String(ev.raw._id));
                                    const dstate = item ? dnd.stateFor(item) : {};
                                    const place = item ? dnd.placeFor(item) : { dateKey: k, startMin: ev.startMin, endMin: ev.endMin };
                                    const h = ((place.endMin - place.startMin) / 60) * HOUR_PX;
                                    // A booking dragged to another day is offset a whole column
                                    // rather than re-parented: removing the element from the DOM
                                    // would release the pointer capture and drop the gesture.
                                    const colShift = dstate.dragging ? dayKeys.indexOf(place.dateKey) - colIdx : 0;
                                    const canDrag = !!onReschedule && !!item && !item.locked;

                                    return (
                                        <button
                                            type="button"
                                            key={ev.raw._id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (dnd.shouldIgnoreClick()) return;
                                                onEventClick && onEventClick(ev.raw);
                                            }}
                                            onPointerDown={canDrag
                                                ? (e) => dnd.onPointerDown(item, e.target?.dataset?.grip != null ? 'resize' : 'move')(e)
                                                : undefined}
                                            onKeyDown={canDrag ? dnd.onKeyDown(item) : undefined}
                                            style={{
                                                position: 'absolute', top: `${pxOf(place.startMin)}px`, height: `${Math.max(h - 2, 22)}px`,
                                                left: dstate.dragging
                                                    ? `calc(${colShift * 100}% + 2px)`
                                                    : `calc(${(ev.col / ev.cols) * 100}% + 2px)`,
                                                width: dstate.dragging ? 'calc(100% - 4px)' : `calc(${100 / ev.cols}% - 4px)`,
                                                zIndex: dstate.dragging ? 30 : 2, textAlign: 'left', overflow: 'hidden',
                                                cursor: canDrag ? (dstate.dragging ? 'grabbing' : 'grab') : 'pointer',
                                                // Permanently none, not set at press time: iOS decides scroll-vs-drag
                                                // at touchstart and won't reconsider. The hook scrolls by hand instead.
                                                touchAction: canDrag ? 'none' : undefined,
                                                // A press-and-hold on text is a TEXT SELECTION to the browser, and on
                                                // iOS it also raises the copy/look-up callout. Both steal the gesture,
                                                // so the card ends up highlighting words instead of being picked up.
                                                userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                                                display: 'flex', flexDirection: 'column', lineHeight: 1.12,
                                                background: pal.bg, border: '1px solid var(--border)',
                                                borderLeft: `3px ${dim ? 'dashed' : 'solid'} ${pal.rail}`,
                                                borderStyle: dstate.blocked || dstate.displacing ? 'dashed' : 'solid',
                                                borderLeftStyle: dstate.blocked ? 'dashed' : dim ? 'dashed' : 'solid',
                                                borderRadius: '8px',
                                                padding: h >= 44 ? '0.28rem 0.42rem' : '0.1rem 0.42rem', color: 'var(--charcoal)', fontFamily: 'var(--font-body)',
                                                // Finished work recedes; the staff hue stays so you can still read
                                                // whose booking it was. saturate() keeps the fade from turning the
                                                // rail muddy — it reads as "settled", not "broken".
                                                boxShadow: dstate.dragging && !dstate.blocked ? 'var(--shadow-lg, 0 10px 24px -6px rgba(4,5,5,0.28))'
                                                    : st.recede ? 'none' : 'var(--shadow-sm)',
                                                // Translucent while it would displace someone, so the bookings
                                                // underneath — the ones about to be shoved — stay visible.
                                                opacity: dstate.displacing ? 0.74 : st.recede ? 0.55 : dim ? 0.78 : 1,
                                                filter: st.recede ? 'saturate(0.75)' : 'none',
                                                outline: dstate.bumped ? '2px dashed var(--charcoal)' : 'none',
                                                outlineOffset: '-3px',
                                                transform: dstate.dragging && !dstate.blocked && !dstate.displacing ? 'scale(1.02)' : 'none',
                                            }}
                                        >
                                            {ev.isRecurring && <span aria-hidden="true" title="Repeats" style={{ position: 'absolute', top: '2px', right: '4px', fontSize: '0.66rem', opacity: 0.6 }}>⟳</span>}
                                            {st.mark && (
                                                <span
                                                    title={st.markTitle}
                                                    aria-label={st.markTitle}
                                                    style={{ position: 'absolute', bottom: '2px', right: '5px', fontSize: '0.66rem', fontWeight: 700, opacity: 0.75, lineHeight: 1 }}
                                                >{st.mark}</span>
                                            )}
                                            {/* Rows are height-gated like the day view (StaffLanesDay), so a
                                                short card shows just the client's name cleanly instead of
                                                stacking name + service into ~22px and clipping both. The name
                                                is the headline and always renders; the time and service fill
                                                in as the card gets taller. Thresholds mirror the day view's
                                                minute cut-offs at this grid's 76px/hour. */}
                                            {h >= 48 && (
                                                <div style={{ fontSize: '0.58rem', fontWeight: 600, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
                                                    {f12(ev.startMin)} – {f12(ev.endMin)}
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.74rem', fontWeight: 600, paddingRight: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <span className="fc-event-appt-client">{ev.client}</span>
                                            </div>
                                            {/* Service · staff — gated so it never crowds a short card. The
                                                staff-lanes e2e asserts .fc-event-appt-staff is visible; its
                                                seeded booking is 60 min (h≈76 ≥ 56), so the staff name still
                                                shows there. */}
                                            {h >= 56 && (
                                                <div style={{ fontSize: '0.63rem', opacity: 0.85, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {ev.service}
                                                    {ev.staffName && staffFilter === 'all' && <> · <span className="fc-event-appt-staff">{ev.staffName}</span></>}
                                                </div>
                                            )}
                                            {/* Bottom edge grabs to change the length. Same press-and-hold
                                                as a move — the handler reads data-grip to pick the mode. */}
                                            {canDrag && h >= 44 && (
                                                <span
                                                    data-grip=""
                                                    aria-hidden="true"
                                                    style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '12px', cursor: 'ns-resize' }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}

                                {/* Now indicator */}
                                {sel && nowMin >= winStart && nowMin <= winEnd && (
                                    <div aria-hidden="true" style={{ position: 'absolute', top: `${pxOf(nowMin)}px`, left: 0, right: 0, zIndex: 4, borderTop: '2px solid var(--gold)', pointerEvents: 'none' }}>
                                        <span style={{ position: 'absolute', left: '-3px', top: '-4px', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--gold)', display: 'block' }} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Running commentary on the gesture. Visually quiet, but it is the
                only channel a screen-reader user has for a drag in progress. */}
            {dnd.status && (
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40,
                        padding: '0.4rem 0.7rem', borderTop: '1px solid var(--border)',
                        background: 'var(--card-bg)', color: 'var(--text-muted)',
                        fontSize: '0.72rem', pointerEvents: 'none',
                    }}
                >
                    {dnd.status.text || (dnd.status.place
                        ? `${f12(dnd.status.place.startMin)} – ${f12(dnd.status.place.endMin)}`
                        : '')}
                </div>
            )}

            <ConflictSheet
                sheet={dnd.sheet}
                fmt={f12}
                busy={dnd.busy}
                onChoose={dnd.chooseRoute}
                onCancel={dnd.cancelSheet}
            />
        </div>
    );
};

export default CalendarGrid;
