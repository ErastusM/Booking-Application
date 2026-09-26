/**
 * What the owner's Team card says about a pending invite, and how long Resend
 * stays disabled after a send. Pure, so it is unit-tested.
 *
 * Every invite email works for 7 days until one is accepted (the API keeps
 * them all), so a Resend no longer kills the email the member may have open —
 * the card says so, instead of nudging the owner to resend "just in case".
 */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const toDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

export const relativeSent = (sentAt, now = Date.now()) => {
    const d = toDate(sentAt);
    if (!d) return '';
    const mins = Math.floor((now - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return `on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
};

export const untilDate = (expiresAt) => {
    const d = toDate(expiresAt);
    return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
};

/** { kind: 'none' | 'active' | 'expired', sent, until } */
export const inviteStatus = ({ sentAt, expiresAt } = {}, now = Date.now()) => {
    const exp = toDate(expiresAt);
    if (!toDate(sentAt) || !exp) return { kind: 'none', sent: '', until: '' };
    return {
        kind: exp.getTime() > now ? 'active' : 'expired',
        sent: relativeSent(sentAt, now),
        until: untilDate(expiresAt),
    };
};

/** Whole seconds until Resend is allowed again (0 = now). */
export const resendCooldownLeft = (lastSentAt, now = Date.now()) => {
    const d = toDate(lastSentAt);
    if (!d) return 0;
    const left = RESEND_COOLDOWN_MS - (now - d.getTime());
    return left > 0 ? Math.ceil(left / 1000) : 0;
};
