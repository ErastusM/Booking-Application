import { useCallback, useEffect, useRef, useState } from 'react';
import { SNAP_MIN, DAY_MIN, clashesAt, resolutionRoutes } from './resolve';

/**
 * Press-and-hold to pick a booking up, then drag it to a new time.
 *
 * Shared by the day/3-day/week grid and the per-staff lanes, which draw very
 * different DOM but move bookings on exactly the same rules. The hook owns the
 * gesture state machine and the minute/pixel arithmetic; the caller owns the
 * pixels and renders whatever it likes from `placeFor` / `stateFor`.
 *
 * THE SCROLL CONFLICT IS THE WHOLE PROBLEM. The grid scrolls vertically and the
 * gesture also starts as a vertical drag, so the browser has to be told which
 * one is happening. Setting `touch-action` when the press begins is too late —
 * iOS has already decided the touch is a scroll and won't reconsider. So the
 * cards carry `touch-action: none` permanently and we scroll the container by
 * hand for any drag that starts before the hold completes. Anything else works
 * on a desktop mouse and then fails on the phone this is actually for.
 */

const HOLD_MS = 330;    // press-and-hold before the card lifts
const MOVE_TOL = 7;     // px of movement that cancels the hold and scrolls instead
const EDGE = 48;        // px from the edge where the grid starts scrolling itself

const snap = (m) => Math.round(m / SNAP_MIN) * SNAP_MIN;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const useApptDrag = ({
    scrollerRef,          // ref to the scrolling grid body
    hourPx,               // px per hour — the caller's row height
    items,                // [{ id, dateKey, startMin, endMin, staffKey, locked, label }]
    columns,              // dateKeys in display order; length 1 disables sideways (date) moves
    lanes = [],           // staffKeys in display order; length > 1 turns sideways into a LANE
                          // change (a reassignment). Views set columns OR lanes, never both —
                          // a grid moves across days, the staff view moves across people.
    laneLabel,            // (staffKey) => display name, for the reassign chooser's copy
    onCommit,             // ({ moves, mode }) => Promise<void>
    onTap,                // (id) => void — a press that never became a drag
    fmt = String,         // (minutes) => display time, for the chooser's copy
    enabled = true,
}) => {
    const laneName = useCallback((key) => (laneLabel ? laneLabel(key) : '') || '', [laneLabel]);
    const [drag, setDrag] = useState(null);     // live gesture, or null
    const [sheet, setSheet] = useState(null);   // pending collision to resolve
    const [held, setHeld] = useState(null);     // keyboard pick-up
    const [busy, setBusy] = useState(false);

    const g = useRef({});                       // transient pointer bookkeeping
    const autoRef = useRef(0);
    const clickGuard = useRef(0);               // see shouldIgnoreClick

    const itemsRef = useRef(items); itemsRef.current = items;
    const colsRef = useRef(columns); colsRef.current = columns;
    const lanesRef = useRef(lanes); lanesRef.current = lanes;

    const stop = useCallback(() => {
        clearTimeout(g.current.holdTimer);
        cancelAnimationFrame(g.current.raf);
        clearInterval(autoRef.current);
        g.current = {};
    }, []);

    useEffect(() => stop, [stop]);

    /** Where an item should currently be drawn — its live drag position if held. */
    const placeFor = useCallback((item) => {
        if (drag && drag.id === item.id) return drag.place;
        if (held && held.id === item.id && held.place) return held.place;
        return { dateKey: item.dateKey, startMin: item.startMin, endMin: item.endMin, staffKey: item.staffKey };
    }, [drag, held]);

    /** Visual state for an item: is it in hand, is it about to be shoved? */
    const stateFor = useCallback((item) => ({
        dragging: !!(drag && drag.id === item.id) || !!(held && held.id === item.id),
        blocked: !!(drag && drag.id === item.id && drag.blocked),
        displacing: !!(drag && drag.id === item.id && drag.displacing),
        bumped: !!(drag && drag.hitIds && drag.hitIds.indexOf(item.id) !== -1)
            || !!(held && held.hitIds && held.hitIds.indexOf(item.id) !== -1),
    }), [drag, held]);

    /**
     * Re-derive collisions for a candidate placement. Collisions are judged in
     * the DESTINATION lane: once a card is dragged into another staff member's
     * lane, it can only clash with THAT member's bookings, not the ones it left
     * behind — so `place.staffKey` (where it is now) wins over the item's origin.
     */
    const assess = useCallback((id, place, staffKey) => {
        const key = place.staffKey !== undefined ? place.staffKey : staffKey;
        const hits = clashesAt(itemsRef.current, id, place, key);
        const locked = hits.filter((h) => h.locked);
        return {
            hits,
            hitIds: hits.map((h) => h.id),
            // Finished work is the one thing that can't be rescheduled out of the
            // way, so landing on it is a hard refusal rather than a decision.
            blocked: locked.length > 0,
            displacing: locked.length === 0 && hits.length > 0,
        };
    }, []);

    // ── Committing ──────────────────────────────────────────────────────────
    const applyMoves = useCallback(async (moves, mode) => {
        setBusy(true);
        try { await onCommit({ moves, mode }); } finally { setBusy(false); }
    }, [onCommit]);

    const finish = useCallback(async (item, place, origin, mode) => {
        const placeStaff = place.staffKey !== undefined ? place.staffKey : item.staffKey;
        const unchanged = place.dateKey === origin.dateKey
            && place.startMin === origin.startMin && place.endMin === origin.endMin
            && placeStaff === item.staffKey;
        if (unchanged) return;

        const { hits, blocked } = assess(item.id, place, item.staffKey);
        if (blocked) return;

        // Dragged into a DIFFERENT lane: this changes who performs the booking, a
        // reassignment rather than a reschedule. The reassign only ever moves this
        // one booking (the server endpoint takes a single appointment), so it can't
        // also shuffle an occupant out of the way — an occupied destination is a
        // clean refusal here, not a silent half-move. A free destination asks one
        // plain question, same as a same-lane move onto clear time.
        const reassigning = placeStaff !== item.staffKey;
        if (reassigning) {
            if (hits.length) {
                setSheet({
                    kind: 'clash', item, place, origin, mode, hits,
                    routes: [{
                        key: 'busy', tag: 'Busy', primary: false, plan: null,
                        label: `${laneName(placeStaff) || 'That lane'} is booked at ${fmt(place.startMin)}`,
                        reason: 'A reassignment moves one booking at a time — free that slot first, then drag again.',
                    }],
                });
                return;
            }
            const movedDay = place.dateKey !== origin.dateKey;
            setSheet({
                kind: 'confirm', item, place, origin, mode, hits: [],
                reassignTo: laneName(placeStaff),
                routes: [{
                    key: 'move', tag: 'Reassign', primary: true, plan: [],
                    label: `Move to ${fmt(place.startMin)}${movedDay ? ', a different day' : ''}`,
                    detail: [`Was ${fmt(origin.startMin)} – ${fmt(origin.endMin)}`],
                }],
            });
            return;
        }

        // NOTHING is rescheduled by the drop itself. Letting go used to commit
        // straight away on a clear slot, which meant a slip of the finger
        // silently told a customer their appointment had moved — an Undo bar
        // afterwards is a way to take that back, not permission to have done
        // it. Every drop now asks first; a clear slot asks a one-line question,
        // an occupied one asks which way out to take.
        if (!hits.length) {
            const movedDay = place.dateKey !== origin.dateKey;
            setSheet({
                kind: 'confirm',
                item, place, origin, mode, hits: [],
                routes: [{
                    key: 'move',
                    tag: mode === 'resize' ? 'Resize' : 'Move',
                    primary: true,
                    plan: [],                    // nobody else has to move
                    label: mode === 'resize'
                        ? `Change to ${fmt(place.startMin)} – ${fmt(place.endMin)}`
                        : `Move to ${fmt(place.startMin)}${movedDay ? ', a different day' : ''}`,
                    detail: [`Was ${fmt(origin.startMin)} – ${fmt(origin.endMin)}`],
                }],
            });
            return;
        }

        // Landed on somebody: don't decide for them, offer the ways out.
        setSheet({
            kind: 'clash',
            item, place, origin, mode, hits,
            routes: resolutionRoutes({
                items: itemsRef.current, movingId: item.id, place,
                staffKey: item.staffKey, origin, mode, hits, fmt,
            }),
        });
    }, [assess, fmt, laneName]);

    // ── Pointer gesture ─────────────────────────────────────────────────────
    const onPointerDown = useCallback((item, mode) => (e) => {
        if (!enabled || busy || drag || sheet) return;
        if (e.button != null && e.button !== 0) return;
        if (item.locked) { onTap && onTap(item.id, 'locked'); return; }

        const el = e.currentTarget;
        const scroller = scrollerRef.current;
        if (!scroller) return;

        g.current = {
            id: item.id, item, mode, el,
            pointerId: e.pointerId,
            x0: e.clientX, y0: e.clientY,
            scroll0: scroller.scrollTop,
            origin: { dateKey: item.dateKey, startMin: item.startMin, endMin: item.endMin, staffKey: item.staffKey },
            armed: false, moved: false,
        };
        try { el.setPointerCapture(e.pointerId); } catch { /* mouse without capture support */ }

        g.current.holdTimer = setTimeout(() => {
            if (!g.current.id || g.current.armed) return;
            g.current.armed = true;
            if (navigator.vibrate) navigator.vibrate(12);
            const o = g.current.origin;
            g.current.place = { ...o };
            setDrag({ id: item.id, mode, place: { ...o }, origin: o, ...assess(item.id, o, item.staffKey) });
        }, HOLD_MS);
    }, [enabled, busy, drag, sheet, scrollerRef, assess, onTap]);

    const recompute = useCallback((clientX, clientY) => {
        const s = g.current;
        const scroller = scrollerRef.current;
        if (!s.id || !s.armed || !scroller) return;

        const o = s.origin;
        const dyMin = ((clientY - s.y0) + (scroller.scrollTop - s.scroll0)) / hourPx * 60;

        let place;
        if (s.mode === 'resize') {
            const end = clamp(snap(o.endMin + dyMin), o.startMin + SNAP_MIN, DAY_MIN);
            // A resize never crosses lanes — a booking can't grow into another
            // person's day — so the lane it started in is the lane it keeps.
            place = { dateKey: o.dateKey, startMin: o.startMin, endMin: end, staffKey: o.staffKey };
        } else {
            const dur = o.endMin - o.startMin;
            const start = clamp(snap(o.startMin + dyMin), 0, DAY_MIN - dur);
            let dateKey = o.dateKey;
            let staffKey = o.staffKey;
            // Horizontal is one axis or the other, never both: a day grid maps it to
            // a different DATE, the staff view maps it to a different LANE (person).
            const cols = colsRef.current;
            const lns = lanesRef.current;
            if (cols.length > 1 && s.trackWidth) {
                const from = cols.indexOf(o.dateKey);
                const to = clamp(from + Math.round((clientX - s.x0) / s.trackWidth), 0, cols.length - 1);
                dateKey = cols[to];
            } else if (lns.length > 1 && s.trackWidth) {
                const from = lns.indexOf(o.staffKey);
                const to = clamp(from + Math.round((clientX - s.x0) / s.trackWidth), 0, lns.length - 1);
                staffKey = lns[to];
            }
            place = { dateKey, startMin: start, endMin: start + dur, staffKey };
        }
        // Bail out when nothing actually changed. Pointer events fire 60–120×/s
        // but the placement only moves every 15 minutes of snap, so without this
        // every single move re-rendered the whole calendar — which is what made
        // a busy day feel frozen mid-drag. Returning the SAME state object lets
        // React skip the render entirely.
        s.place = place;
        setDrag((d) => {
            if (!d) return d;
            if (d.place.dateKey === place.dateKey
                && d.place.startMin === place.startMin
                && d.place.endMin === place.endMin
                && d.place.staffKey === place.staffKey) return d;
            return { ...d, place, ...assess(s.id, place, s.item.staffKey) };
        });
    }, [scrollerRef, hourPx, assess]);

    const onPointerMove = useCallback((e) => {
        const s = g.current;
        if (!s.id || e.pointerId !== s.pointerId) return;
        const scroller = scrollerRef.current;
        if (!scroller) return;

        const dx = e.clientX - s.x0;
        const dy = e.clientY - s.y0;

        // Before the hold completes this is a scroll, not a drag. We drive it by
        // hand — see the note at the top about why touch-action can't do it.
        if (!s.armed) {
            if (Math.abs(dx) > MOVE_TOL || Math.abs(dy) > MOVE_TOL) {
                s.moved = true;
                clearTimeout(s.holdTimer);
                scroller.scrollTop = s.scroll0 - dy;
            }
            return;
        }

        s.moved = true;
        s.lastX = e.clientX; s.lastY = e.clientY;
        if (!s.trackWidth && (colsRef.current.length > 1 || lanesRef.current.length > 1)) {
            // One column/lane is marked rather than the whole grid: the grid also
            // contains the time gutter, so dividing its width by the column count
            // would come out short and sideways drags would overshoot. The staff
            // view marks one lane body the same way, so the same measurement drives
            // both a date step and a lane step.
            const track = scroller.querySelector('[data-col-track]');
            if (track) s.trackWidth = track.getBoundingClientRect().width;
        }
        recompute(e.clientX, e.clientY);

        // Drag near an edge and the grid scrolls itself.
        clearInterval(autoRef.current);
        const r = scroller.getBoundingClientRect();
        const dir = e.clientY < r.top + EDGE ? -1 : e.clientY > r.bottom - EDGE ? 1 : 0;
        if (dir) {
            autoRef.current = setInterval(() => {
                if (!g.current.armed) { clearInterval(autoRef.current); return; }
                scroller.scrollTop += dir * 9;
                recompute(g.current.lastX, g.current.lastY);
            }, 16);
        }
    }, [scrollerRef, recompute]);

    const onPointerUp = useCallback((e) => {
        const s = g.current;
        if (!s.id || (e && e.pointerId !== s.pointerId)) return;
        clearInterval(autoRef.current);
        clearTimeout(s.holdTimer);

        const wasArmed = s.armed;
        const item = s.item;
        const origin = s.origin;
        const mode = s.mode;
        // The last placement is kept on the gesture record as well as in state,
        // precisely so the commit below doesn't have to reach into a state
        // updater to find it (see the note on setDrag).
        const place = s.place;
        g.current = {};

        // The browser still fires a click after this pointerup. Without the
        // guard, every completed drag would also open the booking's sheet.
        if (wasArmed) clickGuard.current = Date.now() + 400;

        // Committing MUST NOT happen inside a setState updater. React treats
        // updaters as pure and calls them twice under StrictMode, so doing the
        // commit there fired two batch requests per drop — the second one lost
        // its race guard, 409'd, and rolled the first straight back.
        setDrag(null);
        if (wasArmed && place) finish(item, place, origin, mode);
        else if (!wasArmed && !s.moved) onTap && onTap(item.id);
    }, [finish, onTap]);

    // Safety net. The gesture normally ends via the scroller's own pointerup,
    // which works because pointer capture retargets events to the card. But
    // capture can fail (or be lost when the element re-renders), and then the
    // pointerup lands somewhere else entirely — leaving the gesture armed and
    // the auto-scroll interval running forever, which reads as a frozen
    // calendar. These listeners end it wherever the finger actually lifts.
    // Double-firing is harmless: onPointerUp clears the record and then returns
    // early on any second call.
    useEffect(() => {
        if (!enabled) return undefined;
        const end = (e) => onPointerUp(e);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        return () => {
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }, [enabled, onPointerUp]);

    // A lifted card sweeps across the grid, and the browser paints a text
    // selection over everything the pointer crosses — labels, times, the other
    // cards. The cards set user-select:none on themselves, but that only stops a
    // selection from STARTING on a card, not the sweep across everything around
    // it. Kill selection document-wide for the life of the gesture and restore it
    // on drop, so ordinary text stays selectable the rest of the time (staff copy
    // a client's number, an address). Keyed on the boolean, not the drag object,
    // which changes identity on every snap and would thrash the listener.
    const dragging = !!drag;
    useEffect(() => {
        if (!dragging) return undefined;
        const { body } = document;
        const prevUserSelect = body.style.userSelect;
        const prevWebkit = body.style.webkitUserSelect;
        body.style.userSelect = 'none';
        body.style.webkitUserSelect = 'none';
        const blockSelect = (e) => e.preventDefault();
        document.addEventListener('selectstart', blockSelect);
        return () => {
            body.style.userSelect = prevUserSelect;
            body.style.webkitUserSelect = prevWebkit;
            document.removeEventListener('selectstart', blockSelect);
        };
    }, [dragging]);

    // ── Keyboard equivalent ─────────────────────────────────────────────────
    // Drag-only would lock out anyone not using a pointer, so the same move
    // exists on the keys.
    const onKeyDown = useCallback((item) => (e) => {
        if (!enabled || busy || sheet) return;
        const mine = held && held.id === item.id;

        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!mine) {
                if (item.locked) { onTap && onTap(item.id, 'locked'); return; }
                const o = { dateKey: item.dateKey, startMin: item.startMin, endMin: item.endMin, staffKey: item.staffKey };
                setHeld({ id: item.id, item, origin: o, place: { ...o }, ...assess(item.id, o, item.staffKey) });
                return;
            }
            const place = held.place;
            setHeld(null);
            finish(item, place, held.origin, 'move');
            return;
        }
        if (!mine) return;

        if (e.key === 'Escape') { e.preventDefault(); setHeld(null); return; }

        let dm = 0, dcol = 0;
        if (e.key === 'ArrowUp') dm = e.shiftKey ? -60 : -SNAP_MIN;
        else if (e.key === 'ArrowDown') dm = e.shiftKey ? 60 : SNAP_MIN;
        else if (e.key === 'ArrowLeft') dcol = -1;
        else if (e.key === 'ArrowRight') dcol = 1;
        else return;

        e.preventDefault();
        setHeld((h) => {
            if (!h) return h;
            const dur = h.place.endMin - h.place.startMin;
            const start = clamp(h.place.startMin + dm, 0, DAY_MIN - dur);
            let dateKey = h.place.dateKey;
            let staffKey = h.place.staffKey;
            // Left/right walks the same axis the pointer would: a date in the grid,
            // a lane (person) in the staff view — so a reassignment is reachable
            // from the keyboard too, not pointer-only.
            const cols = colsRef.current;
            const lns = lanesRef.current;
            if (dcol && cols.length > 1) {
                dateKey = cols[clamp(cols.indexOf(dateKey) + dcol, 0, cols.length - 1)];
            } else if (dcol && lns.length > 1) {
                staffKey = lns[clamp(lns.indexOf(staffKey) + dcol, 0, lns.length - 1)];
            }
            const place = { dateKey, startMin: start, endMin: start + dur, staffKey };
            return { ...h, place, ...assess(h.id, place, h.item.staffKey) };
        });
    }, [enabled, busy, sheet, held, assess, finish, onTap]);

    // ── Answering the chooser ───────────────────────────────────────────────
    const chooseRoute = useCallback(async (route) => {
        const s = sheet;
        setSheet(null);
        if (!s || !route || !route.plan) return;

        const primary = { id: s.item.id, ...s.place };

        if (route.plan === 'manual') {
            const victim = s.hits[0];
            await applyMoves([primary], s.mode);
            // Hand the displaced booking straight over, already picked up.
            const o = { dateKey: victim.dateKey, startMin: victim.startMin, endMin: victim.endMin, staffKey: victim.staffKey };
            setHeld({ id: victim.id, item: victim, origin: o, place: { ...o }, ...assess(victim.id, o, victim.staffKey) });
            return;
        }

        await applyMoves([primary, ...route.plan.map((m) => ({ id: m.id, dateKey: m.dateKey, startMin: m.startMin, endMin: m.endMin }))], s.mode);
    }, [sheet, applyMoves, assess]);

    const cancelSheet = useCallback(() => setSheet(null), []);

    /** True while a click is only the tail of a drag that just finished. */
    const shouldIgnoreClick = useCallback(() => Date.now() < clickGuard.current, []);

    return {
        drag, held, sheet, busy, shouldIgnoreClick,
        placeFor, stateFor,
        onPointerDown, onPointerMove, onPointerUp, onKeyDown,
        chooseRoute, cancelSheet,
        // Live status text for the caller's aria-live region.
        status: (() => {
            const live = drag || held;
            if (sheet) {
                if (sheet.kind === 'confirm' && sheet.reassignTo) {
                    return { tone: 'active', text: `Reassigning to ${sheet.reassignTo} — confirm to apply.` };
                }
                return { tone: 'displace', text: 'That time is already booked — choose what happens to the other booking.' };
            }
            if (!live) return null;
            // A drag into another lane is a reassignment, not a reschedule — the
            // overlap copy below ("reschedule both") would be a lie there.
            const reassigning = live.place && live.origin
                && live.place.staffKey !== undefined && live.place.staffKey !== live.origin.staffKey;
            if (live.blocked) return { tone: 'blocked', text: `${live.hits.filter((h) => h.locked)[0].label} has already finished, and finished work stays put.` };
            if (reassigning && live.displacing) {
                return { tone: 'displace', text: `${laneName(live.place.staffKey) || 'That lane'} is busy then — free the slot or drop on an open time.` };
            }
            if (reassigning) {
                return { tone: 'active', text: `Reassign to ${laneName(live.place.staffKey) || 'this lane'}?`, place: live.place };
            }
            if (live.displacing) {
                const extra = live.hits.length > 1 ? ` and ${live.hits.length - 1} more` : '';
                return { tone: 'displace', text: `Overlaps ${live.hits[0].label}${extra}. Let go and you can reschedule ${live.hits.length > 1 ? 'them' : 'both'}.` };
            }
            return { tone: 'active', text: null, place: live.place };
        })(),
    };
};

export default useApptDrag;
