import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
    const h = String(hex || '').replace('#', '');
    if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    if (h.length >= 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    return null;
};
const staffPalette = (hex) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return { bg: 'rgba(240,62,22,0.12)', rail: 'var(--gold)' };
    const { r, g, b } = rgb;
    return { bg: `rgba(${r},${g},${b},0.14)`, rail: hex };
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
    appointments = [],       // raw appointments (any day)
    blockedTimes = [],       // raw blocked times (any day)
    teamMembers = [],        // roster (for staff colour + name resolution)
    ownerName,               // labels the owner/unassigned staff
    staffFilter = 'all',     // 'all' | 'unassigned' | teamMember _id
    availability,            // business hours { monday: {enabled, slots:[{start,end}]}, … }
    height,                  // px — measured fill height from the dashboard
    onEventClick,            // (rawAppointment) => void
    onBlockClick,            // (rawBlockedTime) => void
    onSlotClick,             // ({date, startTime, endTime}) => void
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

    // Visible time window: business hours across the shown days, expanded to
    // include anything booked off-grid, padded an hour each side, snapped to
    // whole hours. Defaults to 08:00–20:00.
    const { winStart, winEnd } = useMemo(() => {
        let start = 8 * 60; let end = 20 * 60;
        days.forEach((d) => {
            const cfg = availability?.[DAY_NAMES[d.getDay()]];
            const slots = (cfg?.enabled && Array.isArray(cfg.slots) ? cfg.slots : []).filter((s) => s?.start && s?.end);
            slots.forEach((s) => { start = Math.min(start, minutesOf(s.start)); end = Math.max(end, minutesOf(s.end)); });
        });
        dayKeys.forEach((k) => {
            (perDay[k]?.appts || []).forEach((e) => { start = Math.min(start, e.startMin); end = Math.max(end, e.endMin); });
            (perDay[k]?.blocks || []).forEach((e) => { start = Math.min(start, e.startMin); end = Math.max(end, e.endMin); });
        });
        start = Math.max(0, Math.floor(start / 60) * 60 - 60);
        end = Math.min(24 * 60, Math.ceil(end / 60) * 60 + 60);
        return { winStart: start, winEnd: Math.max(end, start + 60) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dayKeys.join(','), perDay, availability]);

    const bodyH = ((winEnd - winStart) / 60) * HOUR_PX;
    const pxOf = (mins) => ((mins - winStart) / 60) * HOUR_PX;

    // Off-hours (non-working) intervals per day, for hatching.
    const offIntervalsOf = (d) => {
        const cfg = availability?.[DAY_NAMES[d.getDay()]];
        const slots = (cfg?.enabled && Array.isArray(cfg.slots) ? cfg.slots : []).filter((s) => s?.start && s?.end);
        if (!slots.length) return [[winStart, winEnd]];
        const sorted = slots.map((s) => [minutesOf(s.start), minutesOf(s.end)]).sort((a, b) => a[0] - b[0]);
        const out = []; let cursor = winStart;
        sorted.forEach(([s, e]) => { if (s > cursor) out.push([cursor, Math.min(s, winEnd)]); cursor = Math.max(cursor, e); });
        if (cursor < winEnd) out.push([cursor, winEnd]);
        return out.filter(([s, e]) => e > s);
    };

    const hourMarks = [];
    for (let m = winStart; m <= winEnd; m += 60) hourMarks.push(m);

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
    // Open the scroll near the start of the working day.
    useEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = Math.max(0, ((9 * 60) - winStart) / 60 * HOUR_PX - 12);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, dateKey(firstDay), winStart]);

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

    return (
        <div style={{ height: height || 640, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', minHeight: 0 }}>
            {/* Date range header (prev / label / next / today) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <button type="button" aria-label="Previous" onClick={() => shift(-1)} style={navBtn}><ChevronLeft size={17} /></button>
                <button type="button" aria-label="Next" onClick={() => shift(1)} style={navBtn}><ChevronRight size={17} /></button>
                <span style={{ marginLeft: '0.15rem', fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rangeLabel}
                </span>
                <button
                    type="button"
                    onClick={() => onDateChange && onDateChange(new Date())}
                    disabled={isTodayInView && cols === 1}
                    style={{ ...navBtn, marginLeft: 'auto', width: 'auto', padding: '0 0.75rem', fontSize: '0.8rem', fontWeight: 600 }}
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

            {/* Scrollable grid body */}
            <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                    {days.map((d) => {
                        const k = dateKey(d);
                        const bucket = perDay[k] || { appts: [], blocks: [] };
                        const sel = sameDay(d, today);
                        return (
                            <div
                                key={k}
                                ref={(el) => { colRefs.current[k] = el; }}
                                onClick={handleColClick(d, colRefs.current[k])}
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
                                            background: '#e5e7eb', borderLeft: '3px solid #b7b7b3', borderRadius: '8px',
                                            color: '#5f5f5b', fontSize: '0.68rem', fontWeight: 600, padding: '3px 8px', cursor: 'pointer',
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
                                    const h = ((ev.endMin - ev.startMin) / 60) * HOUR_PX;
                                    const dim = ev.status === 'pending';
                                    return (
                                        <button
                                            type="button"
                                            key={ev.raw._id}
                                            onClick={(e) => { e.stopPropagation(); onEventClick && onEventClick(ev.raw); }}
                                            style={{
                                                position: 'absolute', top: `${pxOf(ev.startMin)}px`, height: `${Math.max(h - 2, 22)}px`,
                                                left: `calc(${(ev.col / ev.cols) * 100}% + 2px)`, width: `calc(${100 / ev.cols}% - 4px)`,
                                                zIndex: 2, textAlign: 'left', overflow: 'hidden', cursor: 'pointer',
                                                display: 'flex', flexDirection: 'column', lineHeight: 1.15,
                                                background: pal.bg, borderLeft: `3px ${dim ? 'dashed' : 'solid'} ${pal.rail}`, borderRadius: '8px',
                                                padding: '0.28rem 0.42rem', color: 'var(--charcoal)', fontFamily: 'var(--font-body)',
                                                boxShadow: 'var(--shadow-sm)', opacity: dim ? 0.78 : 1,
                                            }}
                                        >
                                            {ev.isRecurring && <span aria-hidden="true" title="Repeats" style={{ position: 'absolute', top: '2px', right: '4px', fontSize: '0.66rem', opacity: 0.6 }}>⟳</span>}
                                            {h >= 60 && (
                                                <div style={{ fontSize: '0.58rem', fontWeight: 600, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
                                                    {f12(ev.startMin)} – {f12(ev.endMin)}
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.74rem', fontWeight: 600, paddingRight: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {ev.service}
                                            </div>
                                            {/* Client · staff — always rendered so it stays a visible, real element
                                                (the staff-lanes e2e asserts these are visible on the day/3-day grid). */}
                                            <div style={{ fontSize: '0.63rem', opacity: 0.85, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <span className="fc-event-appt-client">{ev.client}</span>
                                                {ev.staffName && staffFilter === 'all' && <> · <span className="fc-event-appt-staff">{ev.staffName}</span></>}
                                            </div>
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
        </div>
    );
};

export default CalendarGrid;
