import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { myServicesService, myAvailabilityService, myProfileService } from '../services';

// Shown on a team member's calendar until clients can actually book them:
// they need services of their own and working hours of their own. Nothing is
// inherited from the business, so an empty list here really does mean "not
// bookable yet". Each missing piece links to where it is set.
const StaffReadinessBanner = () => {
    const [missing, setMissing] = useState(null); // null = loading or ready

    useEffect(() => {
        let cancelled = false;
        Promise.all([myServicesService.get(), myAvailabilityService.get(), myProfileService.get()])
            .then(([svc, hrs, me]) => {
                if (cancelled) return;
                // Someone who doesn't take bookings (front desk) has nothing to finish.
                if (me.data.data?.bookable === false) return;
                const d = svc.data.data || {};
                const hasServices = d.offersAllServices
                    ? (d.services || []).length > 0
                    : (d.selected || []).length > 0;
                const schedule = hrs.data.data?.schedule;
                const hasHours = !!schedule && Object.values(schedule).some((day) => day?.enabled && (day.slots || []).length > 0);
                const todo = [];
                if (!hasServices) todo.push({ label: 'add your services and prices', to: '/my-schedule#services' });
                if (!hasHours) todo.push({ label: 'set your working hours', to: '/my-schedule#hours' });
                setMissing(todo.length ? todo : null);
            })
            .catch(() => { /* a readiness hint is best-effort — never block the calendar */ });
        return () => { cancelled = true; };
    }, []);

    if (!missing) return null;
    const done = 2 - missing.length;
    const sentence = missing.map((m) => m.label).join(' and ');

    return (
        <Link
            to={missing[0].to}
            data-testid="staff-readiness"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.9rem', background: 'rgba(240,62,22,0.12)', borderBottom: '1px solid var(--border)', color: 'var(--charcoal)', textDecoration: 'none' }}
        >
            <span aria-hidden="true" style={{ width: '34px', height: '34px', flexShrink: 0, borderRadius: '50%', background: 'var(--gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem' }}>
                {done}/2
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem' }}>Clients can’t book you yet</span>
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    To go live, {sentence}.
                </span>
            </span>
            <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
        </Link>
    );
};

export default StaffReadinessBanner;
