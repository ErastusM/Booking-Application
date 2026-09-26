/**
 * Data-subject rights (compliance audit point 8; GDPR arts. 15/17/20, POPIA
 * ss. 23-24): "Download my data" and a complete account deletion.
 *
 * EXPORT — everything Bookplus holds ABOUT the signed-in person, as JSON:
 * profile, bookings they made, reviews they wrote, wallets and wallet
 * transactions, messages they sent, consents, plus waiting-list entries,
 * favourites, form answers, packages and notifications. A business account
 * also gets its business profile, services and locations. It deliberately
 * leaves out OTHER people's personal data (a business's client list stays in
 * the CRM, not in the owner's personal export).
 *
 * DELETION — what purgeAccount removes or anonymises is listed at the function.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');

const M = (name) => mongoose.model(name);
const load = (name) => { try { return require(`../models/${name}`); } catch { return null; } };
[
    'User', 'Appointment', 'Review', 'Wallet', 'WalletTransaction', 'Message', 'Notification', 'WaitingList',
    'FormSubmission', 'ClientPackage', 'ClientNote', 'Event', 'PushSubscription', 'TeamMember', 'TimeClock',
    'Service', 'Location', 'GiftCard', 'ProviderWallet', 'ProviderWalletTransaction',
].forEach(load);

const SECRET_FIELDS = [
    'password', 'verificationToken', 'verificationTokenExpiry', 'passwordResetToken', 'passwordResetExpiry',
    'staffInvites', 'inviteRequestLog', 'refreshTokenJtis', 'oauthCode', 'oauthCodeExpiry', 'tokenVersion', '__v',
    'staffPermissions', 'staffTier',
];
const clean = (doc) => {
    const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...(doc || {}) };
    for (const f of SECRET_FIELDS) delete o[f];
    return o;
};

const EXPORT_VERSION = 1;

/** Build the "Download my data" document for one user id. */
async function exportAccount(userId) {
    const user = await M('User').findById(userId).lean();
    if (!user) return null;
    const isBusiness = user.role !== 'customer';
    const ownsEmail = user.isVerified === true || !!user.googleId;

    const bookingQuery = ownsEmail
        ? { $or: [{ customer: user._id }, { guestEmail: user.email }] }
        : { customer: user._id };
    const [
        bookings, reviews, wallets, walletTxns, messagesSent, waitingList, formAnswers,
        packages, notifications, providerTxns,
    ] = await Promise.all([
        M('Appointment').find(bookingQuery).populate('service', 'name').populate('provider', 'name businessProfile.businessName')
            .select('-manageToken').sort({ appointmentDate: -1 }).lean(),
        M('Review').find({ customer: user._id }).populate('service', 'name').lean(),
        M('Wallet').find({ customer: user._id }).populate('provider', 'name').lean(),
        M('WalletTransaction').find({ customer: user._id }).sort({ createdAt: -1 }).lean(),
        M('Message').find({ sender: user._id }).select('recipient appointment content createdAt').sort({ createdAt: -1 }).lean(),
        M('WaitingList').find({ customer: user._id }).lean(),
        M('FormSubmission').find({ customer: user._id }).lean(),
        M('ClientPackage').find({ customer: user._id }).lean(),
        M('Notification').find({ user: user._id }).sort({ createdAt: -1 }).limit(500).lean(),
        isBusiness ? M('ProviderWalletTransaction').find({ provider: user._id }).sort({ createdAt: -1 }).lean() : [],
    ]);

    const tidyTxn = (t) => {
        const o = { ...t };
        o.hasProof = Boolean((o.proof && o.proof.publicId) || o.proofUrl);
        delete o.proof; delete o.proofUrl; delete o.__v;
        return o;
    };

    const business = isBusiness && user.role === 'provider' ? {
        businessProfile: user.businessProfile,
        portfolio: user.portfolio,
        walletSettings: user.walletSettings,
        bookingPolicy: user.bookingPolicy,
        services: await M('Service').find({ provider: user._id }).lean(),
        locations: await M('Location').find({ provider: user._id }).lean(),
        bookingsReceived: await M('Appointment').countDocuments({ provider: user._id }),
        note: 'Your clients’ details and their bookings with you are your business records; view or export them from the Clients screen.',
    } : undefined;

    const profile = clean(user);
    delete profile.businessProfile; delete profile.portfolio; delete profile.walletSettings; delete profile.bookingPolicy;
    delete profile.consentLog; delete profile.marketingEmails; delete profile.consentedAt; delete profile.ageConfirmedAt;

    return {
        export: { format: 'bookplus-account-export', version: EXPORT_VERSION, generatedAt: new Date().toISOString() },
        profile,
        consents: {
            termsAndPrivacyAcceptedAt: user.consentedAt || null,
            ageConfirmedAt: user.ageConfirmedAt || null,
            marketingEmails: user.marketingEmails || { optIn: false },
            history: user.consentLog || [],
            cookieChoice: 'Stored only in your browser (localStorage "bp_consent") — not on our servers.',
        },
        bookings: bookings.map((b) => ({ ...b, __v: undefined })),
        reviews,
        wallets,
        walletTransactions: walletTxns.map(tidyTxn),
        messagesSent,
        waitingList,
        formAnswers,
        packages,
        notifications,
        ...(isBusiness ? { businessAccountTransactions: providerTxns.map(tidyTxn) } : {}),
        ...(business ? { business } : {}),
    };
}

/** Best-effort removal of this person's public images from Cloudinary. */
async function destroyImages(urls) {
    const cloudinary = require('./cloudinary');
    if (!cloudinary.isConfigured()) return 0;
    const cloud = cloudinary.config().cloudName;
    let n = 0;
    for (const url of urls) {
        const p = cloudinary.parseDeliveryUrl(url);
        if (!p || p.cloudName !== cloud) continue;
        try { const r = await cloudinary.destroy({ publicId: p.publicId, resourceType: p.resourceType, type: p.type }); if (r.ok) n += 1; } catch { /* best effort */ }
    }
    return n;
}

const anonEmail = () => `deleted_${crypto.randomBytes(8).toString('hex')}@deleted.bookplus`;

/**
 * Remove or anonymise everything personal about one account. The caller has
 * already confirmed the password and cancelled upcoming bookings.
 *
 * Kept (anonymised) because the other party must keep its records:
 *   - past bookings (date, service, price, status) — the client shows as
 *     "Deleted user"; free-text booking notes are erased;
 *   - wallet balances and wallet / account top-up transactions (accounting
 *     records; see utils/retention for how long);
 *   - reviews (rating and text), shown as by "Deleted user".
 * Deleted:
 *   - name, email, phone, avatar, Google link, password and every token;
 *   - consents log, marketing preference, favourites, blocks, survey answers;
 *   - messages they sent or received, notifications, push subscriptions,
 *     waiting-list entries, their analytics events;
 *   - any business's client notes about them (incl. allergies/health) and
 *     their intake-form answers;
 *   - guest bookings made with their (verified) email: guest name/email/phone;
 *   - their avatar / portfolio / team photos on Cloudinary (when configured).
 * A BUSINESS owner additionally loses: business profile, address and map pin,
 * booking link, portfolio, payment instructions, services (deactivated),
 * locations (deactivated, address cleared), team roster and time-clock
 * records, client notes and form answers it held, gift-card recipient
 * details; and its staff logins are closed and anonymised.
 */
async function purgeAccount(user) {
    const id = user._id;
    const images = [user.avatar, ...((user.portfolio && user.portfolio.images) || [])].filter(Boolean);
    const ownsEmail = user.isVerified === true || !!user.googleId;
    const isOwner = user.role === 'provider';
    const staffIds = isOwner ? (await M('User').find({ staffOf: id, role: 'staff' }).select('_id avatar')).map((s) => s) : [];

    const anonymiseUser = (uid) => M('User').updateOne({ _id: uid }, {
        $set: {
            name: 'Deleted user', email: anonEmail(), phone: 'deleted',
            avatar: null, googleId: null, isActive: false, deletedAt: new Date(),
            favorites: [], blockedUsers: [], staffOf: null, lastLoginAt: null,
            'marketingEmails.optIn': false, consentLog: [], signupSurvey: null, signupSurveyPending: false,
            googleCalendarEmbedUrl: '',
            'businessProfile.businessName': isOwner && String(uid) === String(id) ? 'Closed business' : '',
            'businessProfile.description': '', 'businessProfile.address': '',
            'businessProfile.coordinates': { lat: null, lng: null }, 'businessProfile.slug': null,
            'businessProfile.currentSoftware': '', 'businessProfile.referralSource': '', 'businessProfile.ownerTitle': '',
            'portfolio.images': [], 'portfolio.edits': [], 'portfolio.instagramUrl': '',
            'walletSettings.paymentInstructions': '', 'walletSettings.enabled': false,
        },
        $unset: {
            password: '', refreshTokenJtis: '', verificationToken: '', verificationTokenExpiry: '',
            passwordResetToken: '', passwordResetExpiry: '', oauthCode: '', oauthCodeExpiry: '',
            staffInvites: '', inviteRequestLog: '', ageConfirmedAt: '',
        },
        $inc: { tokenVersion: 1 },
    });

    await anonymiseUser(id);

    const tasks = [
        M('Appointment').updateMany({ customer: id }, { $set: { notes: '' } }),
        M('Message').deleteMany({ $or: [{ sender: id }, { recipient: id }] }),
        M('Notification').deleteMany({ user: id }),
        M('PushSubscription').deleteMany({ user: id }),
        M('WaitingList').deleteMany({ customer: id }),
        M('Event').deleteMany({ user: id }),
        M('ClientNote').deleteMany({ customer: id }),
        M('FormSubmission').deleteMany({ customer: id }),
    ];
    if (ownsEmail && user.email) {
        tasks.push(M('Appointment').updateMany(
            { guestEmail: String(user.email).toLowerCase() },
            { $set: { guestName: 'Deleted guest', guestEmail: null, guestPhone: null, notes: '', 'guestMarketing.optIn': false } },
        ));
    }
    if (isOwner) {
        const roster = await M('TeamMember').find({ provider: id }).select('photoUrl');
        images.push(...roster.map((r) => r.photoUrl).filter(Boolean), ...staffIds.map((s) => s.avatar).filter(Boolean));
        tasks.push(
            M('Service').updateMany({ provider: id }, { $set: { isActive: false } }),
            M('Location').updateMany({ provider: id }, { $set: { isActive: false, address: '' } }),
            M('TeamMember').deleteMany({ provider: id }),
            M('TimeClock').deleteMany({ provider: id }),
            M('ClientNote').deleteMany({ provider: id }),
            M('FormSubmission').deleteMany({ provider: id }),
            M('WaitingList').deleteMany({ provider: id }),
            M('GiftCard').updateMany({ provider: id }, { $set: { recipientName: 'Deleted', recipientEmail: '', fromName: '', message: '' } }),
            ...staffIds.map((s) => anonymiseUser(s._id)),
        );
    }
    await Promise.all(tasks);
    // Images last and without blocking the response on Cloudinary latency.
    destroyImages(images).catch(() => {});
}

module.exports = { exportAccount, purgeAccount, destroyImages, EXPORT_VERSION };
