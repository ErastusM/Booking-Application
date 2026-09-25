import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { providerMarketService } from '../services';

// A team member's personal booking link — www.bookplus.pro/b/<business>/<member>.
// Opens booking with that person already chosen, so their own services, prices
// and hours come first. If the member can't be found (paused, renamed, removed)
// it falls back to the business page rather than a dead end.
const MemberBookingLink = () => {
    const { slug, member } = useParams();
    const [target, setTarget] = useState(null);

    useEffect(() => {
        let alive = true;
        providerMarketService.getMemberBySlug(slug, member)
            .then((r) => {
                if (!alive) return;
                const { providerId, teamMemberId } = r.data.data;
                setTarget(`/book-appointment?providerId=${providerId}&teamMemberId=${teamMemberId}&via=link`);
            })
            .catch(() => { if (alive) setTarget(`/b/${encodeURIComponent(slug)}`); });
        return () => { alive = false; };
    }, [slug, member]);

    if (target) return <Navigate to={target} replace />;

    return (
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '36px', height: '36px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
    );
};

export default MemberBookingLink;
