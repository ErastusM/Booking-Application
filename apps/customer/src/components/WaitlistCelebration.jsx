import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { waitingListService } from '../services';
import StatusOverlay from './StatusOverlay';

// When a waiting-list slot opens up, the API promotes the next customer into a
// real booking and pushes them a notification. This mounts app-wide so that the
// next time they open (or refocus) the app, they get the full-screen celebratory
// moment — shown at most once per promotion per session, even if the server ack
// fails, and never stacked on top of the booking-confirm flow.
const WaitlistCelebration = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [promo, setPromo] = useState(null); // { id, subtitle }
    const busy = useRef(false);                // a fetch is in flight
    const up = useRef(false);                  // an overlay is currently showing
    const shown = useRef(new Set());           // promotion ids already celebrated this session

    const check = async () => {
        // Don't run while signed out, mid-fetch, an overlay is already up, or the
        // user is mid-booking (would stack two full-screen celebratory overlays).
        if (!user || busy.current || up.current) return;
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/book-appointment')) return;
        busy.current = true;
        try {
            const res = await waitingListService.getPendingPromotions();
            const p = (res.data?.data || [])[0];
            if (p && !shown.current.has(p._id)) {
                const svcName = p.service?.name || 'your service';
                const when = p.appointmentDate
                    ? new Date(p.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                    : '';
                up.current = true;
                setPromo({
                    id: p._id,
                    subtitle: `A spot opened up for ${svcName}${when ? ` on ${when}` : ''}${p.startTime ? ` at ${p.startTime}` : ''} — it's all yours!`,
                });
            }
        } catch {
            /* silent — never block the app on this */
        } finally {
            busy.current = false;
        }
    };

    useEffect(() => {
        check();
        // Also catch a promotion that lands while the app is open or backgrounded.
        const onWake = () => { if (document.visibilityState === 'visible') check(); };
        window.addEventListener('focus', onWake);
        document.addEventListener('visibilitychange', onWake);
        return () => {
            window.removeEventListener('focus', onWake);
            document.removeEventListener('visibilitychange', onWake);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    if (!promo) return null;

    const done = () => {
        const { id } = promo;
        shown.current.add(id); // never re-show this promo this session, even if the ack below fails
        up.current = false;
        setPromo(null);
        waitingListService.markPromotionCelebrated(id).catch(() => {});
        navigate('/appointments');
    };

    return (
        <StatusOverlay
            variant="confirmed"
            title="A slot opened up! 🎉"
            subtitle={promo.subtitle}
            onDone={done}
            duration={3200}
        />
    );
};

export default WaitlistCelebration;
