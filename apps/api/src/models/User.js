const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const MAIN_CATEGORIES = require('../constants/mainCategories');

// One-time post-signup friction survey ("Did you experience any difficulties
// signing up?"). Stored as a nullable subdoc: null until the user answers or
// dismisses, so the app shows the in-app prompt exactly once. Admin-visible.
const signupSurveySchema = new mongoose.Schema({
    hadDifficulty: { type: Boolean, default: false },
    comment: { type: String, default: '', trim: true, maxlength: 1000 },
    submittedAt: { type: Date, default: Date.now },
}, { _id: false });

// How clients pay for ONLINE bookings (PAYMENTS_ENABLED). Absent = at the
// appointment, as always. Deposit: `percent` (depositValue 1–100) or `fixed`
// (depositValue in integer cents, capped at the booking's price).
const paymentSettingsSchema = new mongoose.Schema({
    mode: { type: String, enum: ['at_appointment', 'deposit', 'full'], default: 'at_appointment' },
    depositType: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    depositValue: { type: Number, default: null },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

// Where Bookplus pays this business out. Owner-only; never public, never logged.
const payoutAccountSchema = new mongoose.Schema({
    accountHolder: { type: String, trim: true, maxlength: 100 },
    bankName: { type: String, trim: true, maxlength: 100 },
    branchCode: { type: String, trim: true, maxlength: 12 },
    accountNumber: { type: String, trim: true, maxlength: 24 },
    updatedAt: { type: Date, default: null },
}, { _id: false });

// A business's application to take online payments (payment specification,
// section 6): its chosen plan, its legal details, the documents it uploaded
// (private Cloudinary files, opened by Bookplus only through short-lived signed
// links), Bookplus's decision, and the two switches: the business's own
// Online Payments on/off, and Bookplus's override that switches it off.
const verificationDocSchema = new mongoose.Schema({
    kind: { type: String, enum: ['owner_id', 'registration', 'bank_letter', 'other'], required: true },
    name: { type: String, default: '', maxlength: 120 },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ['image', 'raw'], default: 'image' },
    format: { type: String, default: '' },
    deliveryType: { type: String, default: 'authenticated' },
    uploadedAt: { type: Date, default: Date.now },
});
const paymentsApprovalSchema = new mongoose.Schema({
    status: { type: String, enum: ['draft', 'submitted', 'info_requested', 'approved', 'rejected'], default: 'draft' },
    plan: { type: String, enum: ['basic', 'standard', null], default: null },
    legal: {
        businessType: { type: String, enum: ['sole_trader', 'cc', 'company', 'other', null], default: null },
        registeredName: { type: String, default: '', trim: true, maxlength: 120 },
        registrationNumber: { type: String, default: '', trim: true, maxlength: 40 },
        ownerName: { type: String, default: '', trim: true, maxlength: 100 },
        ownerIdNumber: { type: String, default: '', trim: true, maxlength: 30 },
    },
    documents: { type: [verificationDocSchema], default: [] },
    termsAcceptedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // What Bookplus told the business (why rejected, what else it needs).
    decisionNote: { type: String, default: '', maxlength: 1000 },
    // The business's own Online Payments switch (only once approved).
    switchOn: { type: Boolean, default: false },
    // Bookplus switched online payments off for this business.
    adminOff: { type: Boolean, default: false },
    adminOffReason: { type: String, default: '', maxlength: 500 },
    // The payout bank account changed after approval: no payout until
    // Bookplus has checked the new account (a common fraud route).
    payoutAccountReviewNeeded: { type: Boolean, default: false },
    history: {
        type: [{
            _id: false,
            status: String,
            at: { type: Date, default: Date.now },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            note: { type: String, default: '' },
        }],
        default: [],
    },
}, { _id: false });

// Two-step sign-in for admin accounts (utils/mfa.js). The secret is stored
// encrypted; recovery codes only as hashes.
const mfaSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    enabledAt: { type: Date, default: null },
    secretEnc: { type: String, default: null, select: false },
    pendingSecretEnc: { type: String, default: null, select: false },
    lastStep: { type: Number, default: null, select: false },
    recoveryHashes: { type: [String], default: undefined, select: false },
    failures: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
}, { _id: false });

// A business's Bookplus plan. `rates` is what it agreed to when the plan was
// set (later price changes don't reach it until it is moved on purpose);
// `override` is a rate Bookplus agreed with this business alone.
const pricingSchema = new mongoose.Schema({
    plan: { type: String, enum: ['basic', 'standard'], default: null },
    planAssignedAt: { type: Date, default: null },
    pricingVersion: { type: Number, default: null },
    rates: {
        commissionBps: { type: Number, default: null },
        fixedFeeCents: { type: Number, default: null },
    },
    override: {
        commissionBps: { type: Number, default: null },
        fixedFeeCents: { type: Number, default: null },
        note: { type: String, default: '', maxlength: 300 },
    },
}, { _id: false });

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Please add a name'],
            trim: true,
            maxlength: [50, 'Name cannot be more than 50 characters']
        },
        email: {
            type: String,
            required: [true, 'Please add an email'],
            lowercase: true,
            // Linear-time shape check ONLY. The previous pattern
            // (/^\w+([\.-]?\w+)*@.../) nested a quantified group inside a
            // quantifier over the same character class, which backtracks
            // catastrophically: a 30-char address took ~24s of CPU, and because
            // Node is single-threaded one public /register call stalled the whole
            // API. express-validator's isEmail() does the real validation on the
            // routes; this stays as defence-in-depth for paths that bypass them
            // (OAuth sign-up, seeds) and must never contain nested quantifiers.
            match: [
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                'Please provide a valid email'
            ]
        },
        // Which side of the product this account belongs to. One email may hold
        // at most ONE customer account and ONE business account (compound unique
        // index below) — login is scoped by this, so the same email can sign in
        // to the customer app and the business app as two distinct accounts.
        // Derived from role (customer → 'customer'; provider/staff/admin →
        // 'business') and kept in sync on every save.
        accountType: {
            type: String,
            enum: ['customer', 'business'],
            default: 'customer',
        },
        password: {
            type: String,
            minlength: 6,
            select: false,
            required: false,
        },
        phone: {
            type: String,
            required: [true, 'Please add a phone number']
        },
        role: {
            type: String,
            enum: ['customer', 'provider', 'staff', 'admin'],
            default: 'customer'
        },
        // The role an account had before an admin made it an admin, so "Remove
        // admin" can put it back exactly (customer or provider). null for every
        // account that was never promoted — and for admins promoted before this
        // was recorded, who can only be demoted to customer (the console says so).
        roleBeforeAdmin: {
            type: String,
            enum: ['customer', 'provider', null],
            default: null,
        },
        // staff-only: which business (provider User) this staff account works for.
        // null for every other role.
        staffOf: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        // LEGACY — ignored. Team members once had access levels (staffTier) and
        // per-member grants (staffPermissions). There is now one kind of member
        // with one set of access (utils/permissions.js); nothing reads these for
        // access and nothing writes them. Kept so old documents load and history-
        // reading migrations (migrate_owner_performs) can still see them.
        staffPermissions: { type: [String], default: [] },
        staffTier: { type: String, enum: ['basic', 'low', 'medium', 'high', null], default: null },
        providerCategory: {
            type: String,
            default: null,
        },
        provider: {
            type: String,
            enum: ['local', 'google'],
            default: 'local'
        },
        isActive: {
            type: Boolean,
            default: true
        },
        isVerified: {
            type: Boolean,
            default: false,
        },
        // select:false like every other secret — a plain findById must never
        // surface the live 24h token. It leaked via updateProfile/provider-setup,
        // letting an account self-verify without mailbox access (audit).
        verificationToken: {
            type: String,
            default: null,
            select: false,
        },
        verificationTokenExpiry: {
            type: Date,
            default: null,
            select: false,
        },
        googleId: { type: String, default: null },
        avatar: { type: String, default: null },
        tokenVersion: { type: Number, default: 0 },
        // Stamp of the last successful sign-in. null = never signed in — which, for an
        // invited staff account, is what separates "Invited · awaiting login" from an
        // active member on the Team screen.
        lastLoginAt: { type: Date, default: null },
        // Wrong passwords in a row, and until when sign-in is paused after too
        // many (controllers/authController.js login). Never sent to the apps.
        loginFailures: { type: Number, default: 0, select: false },
        loginLockedUntil: { type: Date, default: null, select: false },
        // Hashes of recently-issued refresh-token ids (jti). A refresh token whose jti
        // isn't here is rejected (rotated-away / forged). undefined = legacy, untracked.
        refreshTokenJtis: { type: [String], default: undefined, select: false },
        consentedAt: { type: Date, default: null }, // when the user accepted Terms + Privacy Policy
        // When they confirmed they meet the minimum sign-up age (constants/consent).
        ageConfirmedAt: { type: Date, default: null },
        // Promotional email ("Book again" etc.). OFF unless the person ticks the
        // (unticked) box at sign-up or turns it on in account settings; every
        // marketing email carries a one-click unsubscribe. `source` records where
        // the choice was made (register / settings / unsubscribe_link / google_signup).
        marketingEmails: {
            optIn: { type: Boolean, default: false },
            at: { type: Date, default: null },
            source: { type: String, default: null },
        },
        // Audit trail of consent changes (marketing emails, age, terms), newest
        // last, capped at 50. Part of "Download my data".
        consentLog: {
            type: [{
                _id: false,
                kind: { type: String, required: true },
                value: { type: mongoose.Schema.Types.Mixed },
                source: { type: String, default: null },
                at: { type: Date, default: Date.now },
            }],
            default: [],
        },
        providerSetupComplete: { type: Boolean, default: false },
        googleCalendarEmbedUrl: { type: String, default: '' },
        businessProfile: {
            businessName: { type: String, default: '' },
            // The OWNER's own job title as shown to clients when they appear as a
            // bookable professional (e.g. "Barber"). The owner has no roster row,
            // so without this they'd read as the generic account label "Owner".
            // Blank falls back to "Owner".
            ownerTitle: { type: String, default: '', maxlength: 60 },
            // ISO-4217 currency the business prices in (chosen at onboarding —
            // Bookplus is international). Symbol/format derived from this code.
            currency: { type: String, default: 'NAD', uppercase: true, trim: true },
            // Short tagline shown on discovery cards + the public profile.
            description: { type: String, default: '', maxlength: 200 },
            teamSize: { type: String, default: '' },
            locationType: { type: String, default: '' },
            address: { type: String, default: '' },
            // Exact map-pin coordinates (onboarding step 1). null until the
            // provider drops a pin; the address string stays the human label.
            coordinates: {
                lat: { type: Number, default: null },
                lng: { type: Number, default: null },
            },
            // Human-readable public booking-link handle, e.g. "vibe-barbershop"
            // → www.bookplus.pro/b/vibe-barbershop. Auto-generated from the
            // business name (unique, lowercased). null until generated; the
            // partial index below keeps nulls from colliding.
            slug: { type: String, default: null, lowercase: true, trim: true },
            currentSoftware: { type: String, default: '' },
            referralSource: { type: String, default: '' },
            likesCount: { type: Number, default: 0 }, // public heart count (one heart = private save + public like)
        },
        portfolio: {
            images: [{ type: String }],
            instagramUrl: { type: String, default: '' },
            // Instagram-style posts: every photo in the business's post shares one
            // shape, and each can carry the owner's own framing and adjustments.
            // A photo with no crop is framed automatically: the apps ask Cloudinary
            // for a crop in the post shape around what's in the photo (g_auto).
            shape: { type: String, enum: ['1:1', '4:5', '1.91:1'], default: '1:1' },
            edits: [{
                _id: false,
                url: { type: String, required: true },
                // Crop as fractions of the original image (0–1), plus its natural
                // aspect ratio so a crop can be re-fitted if the shape changes.
                x: Number, y: Number, w: Number, h: Number, ar: Number,
                // Adjustments, each -100…100 (0 = unchanged).
                brightness: Number, contrast: Number, warmth: Number, saturation: Number,
            }],
        },
        // Prepaid wallet config (providers). Opt-in: off until the provider sets it up.
        walletSettings: {
            enabled: { type: Boolean, default: false },
            // wallet_required = client must have funds to book; wallet_optional = pay later
            bookingPaymentMode: { type: String, enum: ['wallet_required', 'wallet_optional'], default: 'wallet_required' },
            refundsAllowed: { type: Boolean, default: true },
            expiryMonths: { type: Number, default: null }, // null = balances never expire
            paymentInstructions: { type: String, default: '' }, // bank / eWallet / PayToday details shown to clients
        },
        // Cancellation policy (providers). Customers may cancel/reschedule up to
        // this many hours before the start time; 0 = anytime. Staff/admin exempt.
        bookingPolicy: {
            // 0 = cancel/reschedule anytime (the default). A provider can set a notice
            // window here to re-enable enforcement for their business.
            cancellationWindowHours: { type: Number, default: 0, min: 0, max: 168 },
        },
        // Online payment setting (providers). Deliberately NOT inside
        // businessProfile, which is served publicly; no default, so accounts
        // that never chose keep an unchanged document ("at the appointment").
        paymentSettings: { type: paymentSettingsSchema, default: undefined },
        // Bank account for payouts (providers). select:false and stripped from
        // toJSON — only the payments endpoints read it, deliberately.
        payoutAccount: { type: payoutAccountSchema, default: undefined, select: false },
        // Post-signup friction survey response (null until answered/dismissed).
        signupSurvey: { type: signupSurveySchema, default: null },
        // True only for accounts created AFTER this feature shipped, so the
        // one-time survey prompt targets genuine new signups. Default false means
        // every pre-existing user hydrates as "don't prompt" — no org-wide blast.
        // Cleared when the survey is answered or dismissed.
        signupSurveyPending: { type: Boolean, default: false },
        // Providers this user has saved (customer-facing favorites)
        favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        // Users this account has blocked — blocks bookings + messaging both ways.
        blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        // Set when the user deletes their account (PII anonymised, sign-in disabled).
        deletedAt: { type: Date, default: null },
        // Set when the user self-deactivates — signing in again reactivates the
        // account (distinct from an admin suspension, which stays blocked).
        deactivatedAt: { type: Date, default: null },
        // Bookplus staff money roles (utils/financeRoles.js). Admin accounts only;
        // empty on an admin = both roles (the owner's original admin).
        adminRoles: { type: [{ type: String, enum: ['finance', 'director'] }], default: undefined },
        // Two-step sign-in (utils/mfa.js) for admin accounts. Only `enabled` is
        // ever read outside the sign-in code; the rest never leaves the API.
        mfa: { type: mfaSchema, default: undefined },
        // Which Bookplus plan this business is on for online payments and the
        // rates it agreed to (services/pricing.js ratesFor). Unset = it has not
        // chosen yet, and nothing changes for it until it does.
        pricing: { type: pricingSchema, default: undefined },
        // Online payments application and switches (see paymentsApprovalSchema).
        // select:false and stripped from toJSON: ID numbers and document refs
        // are read only by the payments endpoints.
        paymentsApproval: { type: paymentsApprovalSchema, default: undefined, select: false },
        oauthCode: { type: String, default: null, select: false },
        oauthCodeExpiry: { type: Date, default: null, select: false },
        // Hash of the browser cookie the code was minted for (utils/handoffBinding).
        oauthCodeBinding: { type: String, default: null, select: false },
        passwordResetToken: { type: String, default: null, select: false },
        passwordResetExpiry: { type: Date, default: null, select: false },
        // Staff set-password invites, kept APART from passwordResetToken. Every
        // Send/Resend pushes an entry (hash of the emailed token only) instead of
        // overwriting one slot, so each unexpired, unused invite email keeps
        // working until one of them is accepted — and the member's own "Forgot
        // password?" can no longer silently kill the invite. Kept small by
        // the retention rules in utils/staffInvites (trimInvites).
        staffInvites: {
            type: [{
                _id: false,
                hash: { type: String, required: true },
                sentAt: { type: Date, required: true },
                expiresAt: { type: Date, required: true },
                usedAt: { type: Date, default: null },
                retiredAt: { type: Date, default: null },
                // Whether the email actually went out. The owner's 60s resend
                // throttle only applies after a delivered send — a failed one
                // must be retryable at once.
                emailed: { type: Boolean, default: false },
                // 'owner' = Send/Resend on the Team screen; 'self' = a link the
                // member asked for. Open owner invites are never trimmed by
                // anything the public "new link" endpoints can trigger.
                source: { type: String, enum: ['owner', 'self'], default: 'owner' },
            }],
            default: undefined,
            select: false,
        },
        // When the invitee asked for a fresh link / sign-in email themselves
        // (renew / request / forgot-password). Per-account cooldown + daily cap.
        inviteRequestLog: { type: [Date], default: undefined, select: false },
    },
    {
        timestamps: true,
        // Defence-in-depth: strip every secret from any serialized user, so an
        // accidental `.select('+password')`-then-res.json (or a missed projection)
        // can never leak credentials or tokens. select:false already keeps them off
        // a plain read; this covers the explicit-select case too.
        toJSON: {
            transform(_doc, ret) {
                delete ret.password;
                delete ret.verificationToken;
                delete ret.verificationTokenExpiry;
                delete ret.passwordResetToken;
                delete ret.passwordResetExpiry;
                delete ret.staffInvites;
                delete ret.inviteRequestLog;
                delete ret.refreshTokenJtis;
                delete ret.oauthCode;
                delete ret.oauthCodeExpiry;
                delete ret.oauthCodeBinding;
                delete ret.loginFailures;
                delete ret.loginLockedUntil;
                delete ret.payoutAccount;
                delete ret.paymentsApproval;
                if (ret.mfa) ret.mfa = { enabled: !!ret.mfa.enabled, enabledAt: ret.mfa.enabledAt || null };
                return ret;
            },
        },
    }
);

// One customer account + one business account per email (staff/admin count as
// business). Replaces the old global-unique email index — production DBs need
// scripts/migrate_account_types.js to drop `email_1` and backfill accountType.
userSchema.index({ email: 1, accountType: 1 }, { unique: true });

// Unique public booking-link slug — PARTIAL so the many null slugs (customers,
// unslugged providers) never collide; only real string slugs are constrained.
userSchema.index(
    { 'businessProfile.slug': 1 },
    { unique: true, partialFilterExpression: { 'businessProfile.slug': { $type: 'string' } } }
);

const BUSINESS_ROLES = ['provider', 'staff', 'admin'];

userSchema.statics.accountTypeForRole = (role) =>
    role === 'customer' ? 'customer' : 'business';

// Role filter equivalent to an accountType — used for lookups so documents
// created before the accountType backfill still authenticate correctly.
userSchema.statics.roleFilterForAccountType = (accountType) =>
    accountType === 'business' ? { $in: BUSINESS_ROLES } : 'customer';

// Keep accountType in lockstep with role (covers create, becomeProvider and
// any other doc.save() that flips the role).
userSchema.pre('validate', function (next) {
    this.accountType = this.role === 'customer' ? 'customer' : 'business';
    next();
});

// bcrypt work factor: 12 (the payment-readiness audit's recommendation).
// Tests run at the minimum so the suite stays fast; BCRYPT_ROUNDS overrides.
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || (process.env.NODE_ENV === 'test' ? 4 : 12);
const hashPassword = async (plain) => bcrypt.hash(plain, await bcrypt.genSalt(BCRYPT_ROUNDS));

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    this.password = await hashPassword(this.password);
    next();
});

// Method to match password
userSchema.methods.matchPassword = async function (enteredPassword) {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

// Auth lookups by these tokens were full collection scans. Sparse: only the few
// users mid-flow hold a value, so the index stays tiny.
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ verificationToken: 1 }, { sparse: true });
userSchema.index({ passwordResetToken: 1 }, { sparse: true });
userSchema.index({ 'staffInvites.hash': 1 }, { sparse: true });
userSchema.index({ oauthCode: 1 }, { sparse: true });

const User = mongoose.model('User', userSchema);
User.BCRYPT_ROUNDS = BCRYPT_ROUNDS;
User.hashPassword = hashPassword;
module.exports = User;
