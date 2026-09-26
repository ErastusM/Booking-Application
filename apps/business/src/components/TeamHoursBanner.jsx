import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * The owner's heads-up, on their calendar: which team members clients can't
 * book because they have no working hours of their own. Nothing is inherited
 * from the business's hours, so such a member simply doesn't appear bookable —
 * and without this the owner only found out on the Team screen. Fed by the
 * `hasHours` the roster (GET /team) already carries; members who aren't
 * bookable anyway (front desk) or have left aren't counted. Links to Team,
 * where each card says "Not bookable — no working hours set".
 */
export const membersWithoutHours = (members) => (members || [])
    .filter((m) => m && m.isActive !== false && m.bookable !== false && m.hasHours === false);

const firstName = (m) => String(m?.name || '').trim().split(/\s+/)[0] || 'A team member';

export const teamHoursSentence = (missing) => {
    if (missing.length === 1) return `${firstName(missing[0])} can’t be booked — no working hours set`;
    if (missing.length === 2) return `${firstName(missing[0])} and ${firstName(missing[1])} can’t be booked — no working hours set`;
    return `${missing.length} team members can’t be booked — no working hours set`;
};

const TeamHoursBanner = ({ members }) => {
    const missing = membersWithoutHours(members);
    if (!missing.length) return null;
    return (
        <Link
            to="/team"
            data-testid="team-hours-banner"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.9rem', background: 'rgba(240,62,22,0.12)', borderBottom: '1px solid var(--border)', color: 'var(--charcoal)', textDecoration: 'none' }}
        >
            <span aria-hidden="true" style={{ minWidth: '34px', height: '34px', padding: '0 0.4rem', flexShrink: 0, borderRadius: '999px', background: 'var(--gold)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem' }}>
                {missing.length}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem' }}>{teamHoursSentence(missing)}</span>
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Clients can’t book them until working hours are set. Set them on Team.
                </span>
            </span>
            <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
        </Link>
    );
};

export default TeamHoursBanner;
