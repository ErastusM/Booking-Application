import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Epic 2.4 — per-staff calendar lanes. One column per staff member (plus the
// owner's "Me / unassigned" lane), a shared time axis, and the same visual
// language as the FullCalendar views: status-coloured appointment cards,
// hatched non-working hours, grey blocked time. FullCalendar's resource
// (per-column) views are a premium plugin, so this view is rendered by hand;
// it deliberately supports tap-to-open and tap-empty-space-to-book, while
// drag-to-move stays in the Day/3 Day/Week views.

const pad = (n) => String(n).padStart(2, '0');
const dateKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Accepts 'YYYY-MM-DD…' strings or Date-ish values, same as the dashboard's toDateString.
const toDateString = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
    return dateKeyOf(new Date(value));
};
const minutesOf = (t) => {
    const [h = 0, m = 0] = String(t || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};
const timeOf = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const HOUR_PX = 64;
const pxOf = (mins) => (mins / 60) * HOUR_PX;
const GUTTER_W = 52;
const LANE_MIN_W = 160;

// Greedy column assignment so overlapping appointments inside one lane sit
// side by side instead of stacking (mirrors FullCalendar's slotEventOverlap=false).
const layoutLane = (events) => {
    const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const clusters = [];
    let cluster = null;
    let clusterEnd = -1;
    sorted.forEach((ev) => {
        if (!cluster || ev.startMin >= clusterEnd) {
            cluster = [];
            clusters.push(cluster);
            clusterEnd = ev.endMin;
        } else {
            clusterEnd = Math.max(clusterEnd, ev.endMin);
        }
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

const navBtnStyle = {
    width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px',
    color: 'var(--charcoal)', cursor: 'pointer',
};

const StaffLanesDay = ({
    date,                    // Date — the day being shown
    onDateChange,            // (Date) => void
    ownerName,               // business owner's display name (labels the unassigned lane)
    teamMembers,             // full roster (active + inactive)
    staffFilter,             // 'all' | 'unassigned' | teamMember _id — narrows the lanes shown
    appointments,            // ALL appointments (any day); filtered here
    blockedTimes,            // ALL blocked times (any day); business-wide ones span every lane
    availability,            // business hours { monday: { enabled, slots: [{start,end}] }, … }
    statusColors,            // same status → {bg,text,borderColor} map the FullCalendar views use
    height,                  // px — measured fill height from the dashboard
    onApptClick,             // (rawAppointment) => void
    onBlockClick,            // (rawBlockedTime) => void
    onSlotClick,             // ({date, startTime, endTime, teamMember}) => void — teamMember '' = unassigned
    headerControl,           // optional node rendered in the header row (e.g. the view switcher)
}) => {
    const dayKey = dateKeyOf(date);
    const isToday = dayKey === dateKeyOf(new Date());

    // Re-render once a minute so the now-indicator keeps moving.
    const [, setMinuteTick] = useState(0);
    useEffect(() => {
        if (!isToday) return undefined;
        const t = setInterval(() => setMinuteTick((n) => n + 1), 60000);
        return () => clearInterval(t);
    }, [isToday]);

    const dayAppts = useMemo(
        () => appointments.filter((a) => a.status !== 'cancelled' && toDateString(a.appointmentDate) === dayKey),
        [appointments, dayKey]
    );
    const dayBlocks = useMemo(
        () => blockedTimes.filter((b) => toDateString(b.date) === dayKey),
        [blockedTimes, dayKey]
    );

    // Lanes: the owner ("Me / unassigned") plus active members — and any inactive
    // member who still has an appointment today, so nothing booked can go invisible.
    const lanes = useMemo(() => {
        const memberIdsWithApptsToday = new Set(
            dayAppts.map((a) => String(a.teamMember?._id || a.teamMember || '')).filter(Boolean)
        );
        const all = [
            { id: 'unassigned', name: ownerName || 'Me', sub: 'Owner · unassigned', color: 'var(--gold)' },
            ...teamMembers
                .filter((m) => m.isActive !== false || memberIdsWithApptsToday.has(String(m._id)))
                .map((m) => ({
                    id: String(m._id),
                    name: m.name,
                    sub: `${m.role || 'Staff'}${m.isActive === false ? ' · inactive' : ''}`,
                    color: m.color || 'var(--gold)',
                })),
        ];
        if (staffFilter === 'all') return all;
        const filtered = all.filter((l) => l.id === String(staffFilter));
        return filtered.length ? filtered : all; // filter points at a vanished member → show everyone
    }, [teamMembers, ownerName, dayAppts, staffFilter]);

    const dayCfg = availability?.[DAY_NAMES[date.getDay()]] || null;
    const daySlots = (dayCfg?.enabled && Array.isArray(dayCfg.slots) ? dayCfg.slots : [])
        .filter((s) => s?.start && s?.end);

    // Time window: working hours ∪ anything already on the calendar, padded an
    // hour each side and snapped to whole hours (same spirit as the FC views'
    // "never hide something booked off-grid" rule).
    const { windowStart, windowEnd } = useMemo(() => {
        let start = daySlots.length ? Math.min(...daySlots.map((s) => minutesOf(s.start))) : 8 * 60;
        let end = daySlots.length ? Math.max(...daySlots.map((s) => minutesOf(s.end))) : 18 * 60;
        dayAppts.forEach((a) => {
            const s = minutesOf(a.startTime);
            const e = minutesOf(a.endTime || '');
            start = Math.min(start, s);
            // endTime at/before startTime = runs past midnight → window to end of day
            end = Math.max(end, !a.endTime ? s + 30 : (e <= s ? 24 * 60 : e));
        });
        dayBlocks.forEach((b) => {
            start = Math.min(start, minutesOf(b.startTime));
            end = Math.max(end, minutesOf(b.endTime));
        });
        start = Math.max(0, Math.floor(start / 60) * 60 - 60);
        end = Math.min(24 * 60, Math.ceil(end / 60) * 60 + 60);
        return { windowStart: start, windowEnd: Math.max(end, start + 60) };
    }, [daySlots, dayAppts, dayBlocks]);

    const bodyH = pxOf(windowEnd - windowStart);

    // Non-working intervals = the complement of business hours inside the window.
    // (Business hours only for now — per-staff hours shading needs StaffAvailability
    // fetched per member; the booking API already enforces those server-side.)
    const offIntervals = useMemo(() => {
        if (!daySlots.length) return [[windowStart, windowEnd]];
        const sorted = daySlots.map((s) => [minutesOf(s.start), minutesOf(s.end)]).sort((a, b) => a[0] - b[0]);
        const out = [];
        let cursor = windowStart;
        sorted.forEach(([s, e]) => {
            if (s > cursor) out.push([cursor, Math.min(s, windowEnd)]);
            cursor = Math.max(cursor, e);
        });
        if (cursor < windowEnd) out.push([cursor, windowEnd]);
        return out.filter(([s, e]) => e > s);
    }, [daySlots, windowStart, windowEnd]);

    // Bucket the day's appointments/blocks per lane. The deleted-member fallback
    // is decided against the FULL roster (not the visible lanes) so that
    // filtering to one lane can't reroute other members' bookings into it —
    // 'unassigned' must mean the same thing here as in the FullCalendar views.
    const perLane = useMemo(() => {
        const rosterIds = new Set(teamMembers.map((m) => String(m._id)));
        const buckets = {};
        lanes.forEach((l) => { buckets[l.id] = { appts: [], blocks: [] }; });
        dayAppts.forEach((a) => {
            const tmId = String(a.teamMember?._id || a.teamMember || '');
            const laneId = tmId && rosterIds.has(tmId) ? tmId : 'unassigned';
            if (!buckets[laneId]) return; // lane filtered out
            const startMin = minutesOf(a.startTime);
            // An endTime at/before startTime means the booking runs past midnight —
            // render it to the end of the day instead of giving it negative height.
            let rawEnd = minutesOf(a.endTime || '');
            if (!a.endTime) rawEnd = startMin + 30;
            else if (rawEnd <= startMin) rawEnd = 24 * 60;
            const endMin = Math.max(rawEnd, startMin + 15);
            buckets[laneId].appts.push({ raw: a, startMin, endMin });
        });
        dayBlocks.forEach((b) => {
            const tmId = String(b.teamMember?._id || b.teamMember || '');
            const startMin = minutesOf(b.startTime);
            const endMin = Math.max(minutesOf(b.endTime), startMin + 15);
            const entry = { raw: b, startMin, endMin, wholeBusiness: !tmId };
            if (!tmId) lanes.forEach((l) => buckets[l.id].blocks.push(entry));
            else if (buckets[tmId]) buckets[tmId].blocks.push(entry);
        });
        Object.values(buckets).forEach((bucket) => { bucket.appts = layoutLane(bucket.appts); });
        return buckets;
    }, [lanes, teamMembers, dayAppts, dayBlocks]);

    const hourMarks = [];
    for (let m = windowStart; m <= windowEnd; m += 60) hourMarks.push(m);

    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const showNowLine = isToday && nowMin >= windowStart && nowMin <= windowEnd;

    const laneRefs = useRef({});
    const handleLaneClick = (lane) => (e) => {
        const el = laneRefs.current[lane.id];
        if (!el || !onSlotClick) return;
        const y = e.clientY - el.getBoundingClientRect().top;
        const raw = windowStart + (y / HOUR_PX) * 60;
        const startMin = Math.max(windowStart, Math.min(windowEnd - 15, Math.floor(raw / 15) * 15));
        const endMin = Math.min(24 * 60 - 1, startMin + 60);
        onSlotClick({
            date: dayKey,
            startTime: timeOf(startMin),
            endTime: timeOf(endMin),
            teamMember: lane.id === 'unassigned' ? '' : lane.id,
        });
    };

    const shiftDay = (delta) => {
        const next = new Date(date);
        next.setDate(next.getDate() + delta);
        onDateChange(next);
    };

    return (
        <div style={{ height: height || 680, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)' }}>
            {/* Header: day navigation (mirrors the FullCalendar toolbar) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '1rem 1.25rem 0.75rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                    <button type="button" aria-label="Previous day" onClick={() => shiftDay(-1)} style={navBtnStyle}><ChevronLeft size={17} /></button>
                    <button type="button" aria-label="Next day" onClick={() => shiftDay(1)} style={navBtnStyle}><ChevronRight size={17} /></button>
                </div>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--charcoal)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })}
                </span>
                {headerControl}
                <button
                    type="button"
                    onClick={() => onDateChange(new Date())}
                    disabled={isToday}
                    style={{ ...navBtnStyle, width: 'auto', padding: '0 0.8rem', fontSize: '0.8rem', fontWeight: 600, opacity: isToday ? 0.45 : 1, cursor: isToday ? 'default' : 'pointer' }}
                >
                    Today
                </button>
            </div>

            {/* One scroll container for both axes; lane headers stick to its top, the time gutter to its left. */}
            {/* overscrollBehavior:'none' — same as CalendarGrid: suppress iOS's elastic
                bounce so dragging past the last hour can't open a gap at the frame edge. */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `${GUTTER_W}px repeat(${lanes.length}, minmax(${LANE_MIN_W}px, 1fr))`, minWidth: `${GUTTER_W + lanes.length * LANE_MIN_W}px` }}>
                    {/* Sticky header row */}
                    <div style={{ position: 'sticky', top: 0, left: 0, zIndex: 6, background: 'var(--card-bg)', borderBottom: '2px solid var(--border)' }} />
                    {lanes.map((lane) => (
                        <div key={`h_${lane.id}`} data-testid="staff-lane-header" style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--card-bg)', borderBottom: '2px solid var(--border)', borderLeft: '1px solid var(--border)', padding: '0.55rem 0.75rem', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '50%', background: lane.color, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lane.name}</span>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {lane.sub}{perLane[lane.id]?.appts.length ? ` · ${perLane[lane.id].appts.length} booked` : ''}
                            </div>
                        </div>
                    ))}

                    {/* Time gutter */}
                    <div style={{ position: 'sticky', left: 0, zIndex: 4, background: 'var(--card-bg)', height: `${bodyH}px`, borderRight: '1px solid var(--border)' }}>
                        {hourMarks.map((m) => (
                            <span key={m} className="tnum" style={{ position: 'absolute', top: `${pxOf(m - windowStart) - 7}px`, right: '6px', fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                                {m === windowStart ? '' : timeOf(m)}
                            </span>
                        ))}
                    </div>

                    {/* Lane bodies */}
                    {lanes.map((lane) => {
                        const bucket = perLane[lane.id] || { appts: [], blocks: [] };
                        return (
                            <div
                                key={`b_${lane.id}`}
                                ref={(el) => { laneRefs.current[lane.id] = el; }}
                                onClick={handleLaneClick(lane)}
                                style={{
                                    position: 'relative',
                                    height: `${bodyH}px`,
                                    borderLeft: '1px solid var(--border)',
                                    cursor: onSlotClick ? 'pointer' : 'default',
                                    // Hour lines, aligned because the window starts on a whole hour
                                    backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)`,
                                }}
                            >
                                {/* Non-working hours (business hours) — hatching + dark-mode
                                    variant live in index.css, shared rules with the FC views */}
                                {offIntervals.map(([s, e], i) => (
                                    <div key={`off_${i}`} aria-hidden="true" className="staff-lane-offhours" style={{ position: 'absolute', top: `${pxOf(s - windowStart)}px`, height: `${pxOf(e - s)}px`, left: 0, right: 0, pointerEvents: 'none' }} />
                                ))}

                                {/* Blocked time — grey overlay behind appointments; tap to edit */}
                                {bucket.blocks.map((blk, i) => (
                                    <div
                                        key={`blk_${blk.raw._id}_${i}`}
                                        onClick={(e) => { e.stopPropagation(); onBlockClick && onBlockClick(blk.raw); }}
                                        title={blk.raw.reason || blk.raw.title || 'Blocked'}
                                        style={{
                                            position: 'absolute', top: `${pxOf(blk.startMin - windowStart)}px`, height: `${pxOf(blk.endMin - blk.startMin)}px`,
                                            left: '2px', right: '2px', zIndex: 1, overflow: 'hidden',
                                            background: '#e5e7eb', border: '1px solid #d1d5db', borderRadius: '6px',
                                            color: '#374151', fontSize: '0.72rem', fontWeight: 600, padding: '3px 8px',
                                            opacity: 0.85, cursor: 'pointer',
                                        }}
                                    >
                                        {blk.raw.reason || blk.raw.title || 'Blocked'}{blk.wholeBusiness && lane.id !== 'unassigned' ? ' · whole business' : ''}
                                    </div>
                                ))}

                                {/* Appointments */}
                                {bucket.appts.map((ev) => {
                                    const colors = statusColors[ev.raw.status] || statusColors.pending;
                                    const clientName = ev.raw.walkInName || ev.raw.guestName || ev.raw.customer?.name || 'Client';
                                    const h = pxOf(ev.endMin - ev.startMin);
                                    return (
                                        <div
                                            key={ev.raw._id}
                                            onClick={(e) => { e.stopPropagation(); onApptClick && onApptClick(ev.raw); }}
                                            data-testid="staff-lane-appt"
                                            style={{
                                                position: 'absolute',
                                                top: `${pxOf(ev.startMin - windowStart)}px`,
                                                height: `${Math.max(h, 20)}px`,
                                                left: `calc(${(ev.col / ev.cols) * 100}% + 3px)`,
                                                width: `calc(${100 / ev.cols}% - 6px)`,
                                                zIndex: 2, overflow: 'hidden', cursor: 'pointer',
                                                background: colors.bg, color: colors.text,
                                                borderLeft: `3px solid ${colors.borderColor || colors.bg}`,
                                                borderRadius: '6px', padding: h >= 40 ? '4px 8px' : '2px 8px',
                                                lineHeight: 1.2, boxShadow: 'var(--shadow-sm)',
                                            }}
                                        >
                                            {h >= 40 && (
                                                <div className="tnum" style={{ fontSize: '0.66rem', fontWeight: 600, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {ev.raw.startTime}{ev.raw.endTime ? ` – ${ev.raw.endTime}` : ''}
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clientName}</div>
                                            {h >= 56 && (
                                                <div style={{ fontSize: '0.7rem', opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.raw.service?.name || 'Appointment'}</div>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Now indicator */}
                                {showNowLine && (
                                    <div aria-hidden="true" style={{ position: 'absolute', top: `${pxOf(nowMin - windowStart)}px`, left: 0, right: 0, zIndex: 3, borderTop: '2px solid #ef4444', pointerEvents: 'none' }}>
                                        <span style={{ position: 'absolute', left: '-1px', top: '-4px', width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444', display: 'block' }} />
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

export default StaffLanesDay;
