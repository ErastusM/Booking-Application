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
        // staff-only: which business (provider User) this staff account works for.
        // null for every other role.
        staffOf: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        // Owner-assigned permission flags, e.g. ['calendar:self','clients:assigned'].
        // Presets map onto these flags so granular control needs no schema change.
        staffPermissions: { type: [String], default: [] },
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
        verificationToken: {
            type: String,
            default: null,
        },
        verificationTokenExpiry: {
            type: Date,
            default: null,
        },
        googleId: { type: String, default: null },
        avatar: { type: String, default: null },
        tokenVersion: { type: Number, default: 0 },
        // Stamp of the last successful sign-in. null = never signed in — which, for an
        // invited staff account, is what separates "Invited · awaiting login" from an
        // active member on the Team screen.
        lastLoginAt: { type: Date, default: null },
        // Hashes of recently-issued refresh-token ids (jti). A refresh token whose jti
        // isn't here is rejected (rotated-away / forged). undefined = legacy, untracked.
        refreshTokenJtis: { type: [String], default: undefined, select: false },
        consentedAt: { type: Date, default: null }, // when the user accepted Terms + Privacy Policy
        providerSetupComplete: { type: Boolean, default: false },
        googleCalendarEmbedUrl: { type: String, default: '' },
        businessProfile: {
            businessName: { type: String, default: '' },
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
            likesCount: { type: Number, default: 0 }, // public ❤️ count (one heart = private save + public like)
        },
        portfolio: {
            images: [{ type: String }],
            instagramUrl: { type: String, default: '' },
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
        oauthCode: { type: String, default: null, select: false },
        oauthCodeExpiry: { type: Date, default: null, select: false },
        passwordResetToken: { type: String, default: null, select: false },
        passwordResetExpiry: { type: Date, default: null, select: false },
    },
    {
        timestamps: true
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

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    next();
});

// Method to match password
userSchema.methods.matchPassword = async function (enteredPassword) {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
