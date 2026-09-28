// Pure rules and wording behind the admin console (/bkplus-command). The API
// enforces every rule here; the console uses them to offer only the actions
// that will work and to say exactly what an action does before it happens.

export const nMoney = (n) => `N$${Number(n || 0).toFixed(2)}`;

/** Who a booking is for, as the admin table shows it. */
export const appointmentClient = (a = {}) => {
    if (a.customer?.name) return { name: a.customer.name, email: a.customer.email || '', tag: null };
    if (a.walkInName) {
        // A client whose account an admin deleted keeps their name on the booking.
        return { name: a.walkInName, email: '', tag: a.clientAccountDeletedAt ? 'Deleted account' : 'Walk-in' };
    }
    if (a.guestName) return { name: a.guestName, email: a.guestEmail || '', tag: 'Guest' };
    // Only bookings from before names were kept on delete can land here.
    return { name: 'Deleted account', email: '', tag: null, missing: true };
};

/** The business a booking belongs to (the API populates provider for admins). */
export const appointmentBusiness = (a = {}) => {
    const p = a.provider;
    if (!p) return { name: 'Removed business', removed: true };
    if (typeof p !== 'object') return { name: '—' };
    const name = p.businessProfile?.businessName?.trim() || p.name || '—';
    return { name, suspended: p.isActive === false && !p.deactivatedAt };
};

const isTeamLogin = (u) => u?.role === 'staff' || !!u?.staffOf;

/** The role as the Users table says it: "Business owner", "Staff · Vido Barber"… */
export const roleLabel = (u = {}) => {
    if (u.role === 'provider') return 'Business owner';
    if (u.role === 'admin') return 'Admin';
    if (u.role === 'staff') {
        const biz = u.staffOf && typeof u.staffOf === 'object'
            ? (u.staffOf.businessProfile?.businessName?.trim() || u.staffOf.name) : '';
        return biz ? `Staff · ${biz}` : 'Staff';
    }
    return 'Customer';
};

/**
 * Which user-row actions to offer, for the signed-in admin `me`.
 * adminCount = how many admins exist (Remove admin is never offered for the last).
 */
export const userActions = (u = {}, me = {}, adminCount = 2) => {
    // The signed-in user carries `id` (login/refresh payloads) or `_id`.
    const myId = me?._id || me?.id;
    const self = !!myId && String(u._id) === String(myId);
    if (self) {
        return { self: true, canDelete: false, deleteBlocked: null, canSuspend: false, canMakeAdmin: false, canRemoveAdmin: false, removeAdminTo: null, removeAdminUnrecorded: false };
    }
    const isAdmin = u.role === 'admin';
    let deleteBlocked = null;
    if (isAdmin) deleteBlocked = 'Remove admin first';
    else if (isTeamLogin(u)) deleteBlocked = 'Their business removes team logins (Team → Remove)';
    return {
        self: false,
        canDelete: !deleteBlocked,
        deleteBlocked,
        canSuspend: !isAdmin,
        canMakeAdmin: !isAdmin && !isTeamLogin(u),
        canRemoveAdmin: isAdmin && !u.isSuperAdmin && adminCount > 1,
        // Where Remove admin takes them: their recorded earlier role, else customer.
        removeAdminTo: isAdmin ? (u.roleBeforeAdmin || 'customer') : null,
        removeAdminUnrecorded: isAdmin && !u.roleBeforeAdmin,
    };
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Delete dialog's wording. `preview` is GET /users/:id/delete-preview.
 * A business owner must type DELETE; a client is a plain confirm.
 */
export const deleteDialog = (u = {}, preview = null) => {
    const who = u.name || 'this account';
    if (u.role === 'provider') {
        const p = preview || {};
        const n = (v) => (typeof v === 'number' ? v : '…');
        return {
            title: `Delete ${who}?`,
            intro: 'Their business is removed from Bookplus right away:',
            bullets: [
                `${typeof p.services === 'number' ? plural(p.services, 'service') : '… services'} switched off — nothing is shown to clients`,
                `${typeof p.teamMembers === 'number' ? plural(p.teamMembers, 'team member') : '… team members'} and their working hours deleted${p.staffLogins ? ` (${plural(p.staffLogins, 'team login')} closed)` : ''}`,
                `${typeof p.upcomingBookings === 'number' ? plural(p.upcomingBookings, 'upcoming booking') : '… upcoming bookings'} cancelled as “Business removed” — clients see it in the app`,
                'No emails are sent',
                `Past bookings (${n(p.pastBookings)}) stay for revenue history`,
            ],
            requireTyping: 'DELETE',
            confirmLabel: 'Delete business owner',
        };
    }
    return {
        title: `Delete ${who}?`,
        intro: 'Their name stays on their past bookings so businesses still see who it was; their account, email and phone are removed.',
        bullets: [],
        requireTyping: null,
        confirmLabel: 'Delete user',
    };
};

/** The Suspend / Activate confirmation. */
export const suspendDialog = (u = {}) => {
    const who = u.name || 'this account';
    if (u.isActive === false) {
        return {
            title: `Activate ${who}?`,
            bullets: u.role === 'provider'
                ? ['They can sign in again', 'Their business is back in search, on its profile and in services', 'Clients can book them again']
                : ['They can sign in again'],
            footer: null,
            confirmLabel: 'Activate',
            danger: false,
        };
    }
    return {
        title: `Suspend ${who}?`,
        bullets: u.role === 'provider'
            ? [
                'The owner and their team can’t sign in',
                'The business disappears from search, its profile and services',
                'No new bookings — existing upcoming bookings stay',
            ]
            : ['They can’t sign in', 'Their bookings stay as they are'],
        footer: 'Activate the account to bring everything back.',
        confirmLabel: 'Suspend',
        danger: true,
    };
};

/** The confirmation for Remove admin. */
export const removeAdminConfirmText = (u = {}) => {
    const to = u.roleBeforeAdmin === 'provider' ? 'business owner' : 'customer';
    return {
        title: `Remove ${u.name || 'this user'}’s admin access?`,
        message: u.roleBeforeAdmin
            ? `They go back to being a ${to} and are signed out.`
            : 'There’s no record of their role before they became an admin, so they become a customer. They are signed out.',
        confirmLabel: 'Remove admin',
    };
};

/** A business's display name (business name, else the owner's name). */
export const businessName = (p = {}) => p?.businessProfile?.businessName?.trim() || p?.name || 'the business';

/** Picker line for a business: its balance, or that it has no wallet yet. */
export const walletLine = (wallet) => (wallet ? `Balance ${nMoney(wallet.balance)}` : `No wallet yet · ${nMoney(0)}`);

/** Submit button: "Credit N$50.00 to Vido Barber". */
export const adjustButtonLabel = (direction, amount, name) => {
    const amt = Number(amount) > 0 ? nMoney(amount) : 'N$…';
    return direction === 'debit' ? `Debit ${amt} from ${name}` : `Credit ${amt} to ${name}`;
};

/** Success toast after a credit / debit / top-up decision. */
export const walletToast = (kind, amount, name, newBalance) => {
    const tail = typeof newBalance === 'number' ? ` · new balance ${nMoney(newBalance)}` : '';
    if (kind === 'credit') return `Credited ${nMoney(amount)} to ${name}${tail}`;
    if (kind === 'debit') return `Debited ${nMoney(amount)} from ${name}${tail}`;
    if (kind === 'approve') return `Approved ${nMoney(amount)} top-up for ${name}${tail}`;
    return `Rejected ${nMoney(amount)} top-up from ${name}`;
};

// How long the "not an admin" note stays up before we take them home.
export const NOTICE_MS = 2200;

// Where a non-admin is taken, and what the note says, by role.
export const nonAdminNotice = (role) => {
    if (role === 'staff') return { text: 'You signed in with a team member login. Taking you to your schedule…', to: '/dashboard' };
    if (role === 'provider') return { text: 'You signed in as a business owner. Taking you to your business dashboard…', to: '/dashboard' };
    return { text: 'You signed in with a client account. Taking you to Bookplus…', to: '/dashboard' };
};
