import { useEffect, useState } from 'react';
import { myProfileService } from '../services';

/**
 * A team member's own roster row — { _id, name, bookable, … } from
 * GET /team/mine/profile — fetched once per signed-in staff user and shared by
 * the bottom nav and the dashboard. Both need it to decide what to offer: the
 * member's own column is where their bookings and blocked time go, and a column
 * that isn't bookable can't take a booking (the server refuses it).
 *
 * Returns null until loaded, and always for owners/admins.
 */
let cache = { userId: null, promise: null };

// Forget the cached row so the next caller re-fetches it (the owner may have
// changed it — e.g. made the member bookable — during this session).
export const refreshMyMember = () => { cache = { userId: null, promise: null }; };

export const loadMyMember = (userId) => {
    if (!userId) return Promise.resolve(null);
    if (cache.userId !== userId || !cache.promise) {
        const promise = Promise.resolve()
            .then(() => myProfileService.get())
            .then((r) => r?.data?.data || null)
            .catch(() => {
                // Don't pin a failure: the next caller retries.
                if (cache.promise === promise) cache = { userId: null, promise: null };
                return null;
            });
        cache = { userId, promise };
    }
    return cache.promise;
};

const staffUserId = (user) => (user?.role === 'staff' ? String(user._id || user.id || '') || null : null);

export default function useMyMember(user) {
    const uid = staffUserId(user);
    const [member, setMember] = useState(null);
    useEffect(() => {
        let live = true;
        if (!uid) { refreshMyMember(); setMember(null); return undefined; }
        loadMyMember(uid).then((m) => { if (live) setMember(m); });
        return () => { live = false; };
    }, [uid]);
    return member;
}
