const User = require('../models/User');
const Category = require('../models/Category');
const { generateToken, generateRefreshToken } = require('../utils/helpers');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/emailService');
const MAIN_CATEGORIES = require('../constants/mainCategories');
const { CURRENCY_CODES } = require('../constants/currencies');
const { notifyAdmins } = require('../utils/notificationhelper');
const { primaryOrigin, businessOrigin, originForRole } = require('../utils/origins');

// How many recent refresh-token ids (jti hashes) to remember per user. Enough to
// cover a handful of concurrent devices without growing unbounded.
const MAX_REFRESH_JTIS = 10;

const hashJti = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

/**
 * Issue a fresh access + refresh token pair for a user and record the new refresh
 * token's id (jti hash) on the account. Keeping a capped list of valid jtis lets
 * /refresh reject a refresh token that was rotated away or forged: its jti won't
 * be in the list. We never mass-revoke here (that would log out every device on a
 * benign double-refresh race) — rejection is per-token via the jti check.
 *
 * `user` must have been loaded with `.select('+refreshTokenJtis')`.
 */
const issueAuthTokens = async (user) => {
    const jti = crypto.randomBytes(16).toString('hex');
    const token = generateToken(user._id, user.tokenVersion);
    const refreshToken = generateRefreshToken(user._id, user.tokenVersion, jti);
    // Atomic append-with-cap: concurrent refreshes (two tabs, or two apps
    // sharing the SSO cookie) must not collide on a document save — the old
    // load-modify-save pattern threw a VersionError on the loser.
    await User.updateOne(
        { _id: user._id },
        { $push: { refreshTokenJtis: { $each: [hashJti(jti)], $slice: -MAX_REFRESH_JTIS } } }
    );
    return { token, refreshToken };
};

/**
 * SSO across subdomains (spec §8): the refresh token also travels in an
 * httpOnly cookie so app.bookplus.pro and business.bookplus.pro can each
 * bootstrap a session from a login made on the other. Subdomains of one
 * registrable domain are same-site, so SameSite=Lax suffices; production
 * sets COOKIE_DOMAIN=.bookplus.pro (localhost needs no Domain attribute —
 * cookies there are port-agnostic, which is what local dev needs).
 * The JSON body keeps returning both tokens — existing clients unchanged.
 */
const REFRESH_COOKIE = 'bp_rt';
const refreshCookieAttrs = () => {
    const parts = ['HttpOnly', 'Path=/api/auth', 'SameSite=Lax'];
    if (process.env.COOKIE_DOMAIN) parts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    return parts;
};
const setRefreshCookie = (res, refreshToken) => {
    const maxAge = 30 * 24 * 60 * 60; // matches REFRESH_TOKEN_EXPIRE default
    res.append('Set-Cookie', [`${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`, `Max-Age=${maxAge}`, ...refreshCookieAttrs()].join('; '));
};
const clearRefreshCookie = (res) => {
    res.append('Set-Cookie', [`${REFRESH_COOKIE}=`, 'Max-Age=0', ...refreshCookieAttrs()].join('; '));
};
const readRefreshCookie = (req) => {
    const match = (req.headers.cookie || '').match(/(?:^|;\s*)bp_rt=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
};

/**
 * =========================
 * REGISTER (LOCAL ONLY)
 * =========================
 */
exports.register = async (req, res) => {
    try {
        const { name, email: rawEmail, password, phone, role, providerCategory } = req.body;
        const email = rawEmail?.trim().toLowerCase();

        // Validate input
        if (!name || !email || !password || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        // Only allow safe roles
        const allowedRoles = ['customer', 'provider'];
        const assignedRole = allowedRoles.includes(role) ? role : 'customer';

        // Duplicate check is scoped per account type: the same email may hold
        // one customer account AND one business account, so only an existing
        // account on the SAME side blocks this registration.
        const accountType = User.accountTypeForRole(assignedRole);
        const existingUser = await User.findOne({
            email,
            role: User.roleFilterForAccountType(accountType),
        });
        if (existingUser) {
            const label = accountType === 'business' ? 'business' : 'customer';
            return res.status(400).json({
                success: false,
                message: `A ${label} account with this email already exists — please sign in instead.`
            });
        }

        // Password complexity check
        const passwordRegex =
            /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message:
                    'Password must be at least 8 characters and include an uppercase letter, a number and a special character'
            });
        }

        if (assignedRole === 'provider' && (!providerCategory || providerCategory.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid provider category'
            });
        }
        if (assignedRole === 'provider' && providerCategory.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Category name is too long'
            });
        }

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const user = await User.create({
            name,
            email,
            password,
            phone,
            role: assignedRole,
            providerCategory: assignedRole === 'provider' ? providerCategory : null,
            provider: 'local',
            isVerified: false,
            verificationToken,
            verificationTokenExpiry,
            consentedAt: new Date(), // consent captured at sign-up (gated in the UI)
            signupSurveyPending: true, // prompt the one-time friction survey for this new account
        });

        if (assignedRole === 'provider') {
            await Category.create({
                name: providerCategory,
                provider: user._id,
                order: 1,
            });
        }

        // Fire-and-forget side effects — must never block or hang the signup response.
        // (SMTP can be slow/blocked on the host; the user is already created and gets a token.)
        notifyAdmins(
            `New ${assignedRole} registered: ${name} (${email})`,
            'system',
            '/bkplus-command'
        ).catch((err) => console.error('notifyAdmins failed:', err.message));

        sendVerificationEmail(email, name, verificationToken, assignedRole)
            .catch((err) => console.error('Verification email failed:', err.message));

        const { token, refreshToken } = await issueAuthTokens(user);
        setRefreshCookie(res, refreshToken);

        res.status(201).json({
            success: true,
            message: 'Registration successful! Please check your email to verify your account.',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    accountType: user.accountType,
                    providerCategory: user.providerCategory,
                    isVerified: false,
                },
                token,
                refreshToken,
            }
        });
    } catch (error) {
        // Two concurrent signups for the same email + account type: the compound
        // unique index catches the race the findOne pre-check missed.
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'An account with this email already exists — please sign in instead.'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Resend the verification email for an unverified account (no auth).
 * Generic response — never reveals whether an email is registered.
 */
exports.resendVerification = async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
        // An email may hold a customer AND a business account — refresh the
        // verification link for every unverified one.
        const users = await User.find({ email });
        for (const user of users) {
            if (user.isVerified) continue;
            user.verificationToken = crypto.randomBytes(32).toString('hex');
            user.verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await user.save();
            sendVerificationEmail(user.email, user.name, user.verificationToken, user.role)
                .catch((err) => console.error('Resend verification failed:', err.message));
        }
        res.status(200).json({ success: true, message: 'If that account exists and is unverified, a new verification link is on its way.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * =========================
 * LOGIN (LOCAL ONLY)
 * =========================
 */
exports.login = async (req, res) => {
    try {
        const { email: rawEmail, password, accountType } = req.body;
        const email = rawEmail?.trim().toLowerCase();

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide an email and password'
            });
        }

        // Each app scopes login to its own side (customer app → 'customer',
        // business app → 'business') so an email that holds both a customer and
        // a business account signs in to the right one. The lookup filters by
        // role rather than the stored accountType so pre-backfill documents
        // still match. No accountType (legacy client) = any account whose
        // password matches.
        const query = accountType
            ? { email, role: User.roleFilterForAccountType(accountType) }
            : { email };
        const candidates = await User.find(query).select('+password +refreshTokenJtis');

        let user = null;
        for (const candidate of candidates) {
            if (await candidate.matchPassword(password)) { user = candidate; break; }
        }

        if (!user) {
            // Right password, wrong side of the app? Only ever revealed to
            // someone who proved they own the account — a plain wrong email or
            // password stays a generic 401 (no account enumeration).
            //
            // AND only when this email has NO account on the side being asked
            // for (candidates is empty). If a business account DOES exist here,
            // a password that doesn't open it is simply the wrong password —
            // calling it "wrong side" is false, and the business login acts on
            // that by handing the person to the customer site, bouncing them off
            // the very door they chose. Split-password and Google-only twins
            // both used to hit that unbreakable loop.
            if (accountType && candidates.length === 0) {
                const others = await User.find({ email }).select('+password');
                for (const other of others) {
                    if (await other.matchPassword(password)) {
                        const otherType = User.accountTypeForRole(other.role);
                        const message = accountType === 'business'
                            ? 'This email is registered as a customer account. Please sign in on the customer app, or create a business account to use the business app.'
                            : 'This email is registered as a business account. Please sign in on the business app, or create a customer account to book appointments.';
                        return res.status(403).json({
                            success: false,
                            message,
                            accountType: otherType,
                        });
                    }
                }
            }
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (user.isActive === false) {
            // Self-deactivated accounts reactivate on a successful sign-in; an admin
            // suspension (no deactivatedAt) stays blocked.
            if (user.deactivatedAt) {
                user.isActive = true;
                user.deactivatedAt = null;
                // issueAuthTokens no longer saves the doc (atomic jti update) —
                // persist the reactivation explicitly.
                await user.save();
            } else {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been suspended. Please contact support.'
                });
            }
        }

        const { token, refreshToken } = await issueAuthTokens(user);
        setRefreshCookie(res, refreshToken);

        // Record the sign-in. Atomic $set (not user.save) so it never trips
        // validation on a partially-selected doc and never races the jti update.
        // First login for an invited staff member flips their Team status from
        // "Invited · awaiting login" to active.
        User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});

        // Does this email hold an account on the OTHER side too? Two different
        // questions, deliberately kept apart:
        //
        //   alsoAccountType — the SAME password also opens that account, so we
        //                     can sign them in over there without asking again.
        //   otherSide       — an account merely EXISTS over there. This is the
        //                     question the website's "Where would you like to
        //                     go?" actually asks, and it stays true when the two
        //                     sides have drifted to different passwords. Drift
        //                     is routine, not exotic: registration is per-side
        //                     (each signup picks its own password) and so is
        //                     password reset, so resetting on one app leaves the
        //                     other untouched. Conflating the two questions is
        //                     what made the chooser silently vanish for people
        //                     who genuinely had both profiles.
        //
        // Existence is only revealed to someone who has proven control of the
        // email address itself — a verified or social account, the same bar as
        // password reset. Registration is per-side and does not require
        // verification, so without that gate anyone could register a throwaway
        // customer account on someone else's email purely to learn that they run
        // a business here.
        let alsoAccountType = null;
        let otherSide = null;
        const ownType = User.accountTypeForRole(user.role);
        const otherType = ownType === 'business' ? 'customer' : 'business';
        const others = await User.find({
            email, _id: { $ne: user._id },
            role: User.roleFilterForAccountType(otherType),
        }).select('+password');
        // An admin-suspended twin cannot be signed into at all, so offering it
        // would be a dead end — it counts as absent on both questions.
        const reachable = others.filter((o) => !(o.isActive === false && !o.deactivatedAt));
        for (const other of reachable) {
            if (!other.password) continue; // social-only login — this password can't open it
            if (await other.matchPassword(password)) { alsoAccountType = otherType; break; }
        }
        const ownsEmailAddress = user.isVerified === true || (user.provider && user.provider !== 'local');
        if (reachable.length && (alsoAccountType || ownsEmailAddress)) {
            otherSide = { accountType: otherType, sameCredentials: alsoAccountType === otherType };
        }

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    accountType: User.accountTypeForRole(user.role),
                    providerCategory: user.providerCategory,
                    avatar: user.avatar,
                    phone: user.phone,
                    providerSetupComplete: user.providerSetupComplete,
                },
                token,
                refreshToken,
                // 'customer' | 'business' | null — the other side these same
                // credentials also unlock. Kept for its original meaning (and
                // for bundles cached before otherSide existed): a non-null value
                // means we can hand them over silently.
                alsoAccountType,
                // { accountType, sameCredentials } | null — the other side an
                // account EXISTS on. This is what the destination chooser reads;
                // sameCredentials: false means that account has its own password,
                // so choosing it means signing in there rather than being carried
                // across.
                otherSide,
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * =========================
 * EXCHANGE OAUTH CODE
 * =========================
 */
exports.exchangeOAuthCode = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, message: 'Code required' });

        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const user = await User.findOne({ oauthCode: codeHash, oauthCodeExpiry: { $gt: new Date() } })
            .select('+oauthCode +oauthCodeExpiry +refreshTokenJtis');

        if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired code' });

        user.oauthCode = null;
        user.oauthCodeExpiry = null;
        // issueAuthTokens no longer saves the doc (atomic jti update) — persist
        // the consumed one-time code explicitly so it can't be replayed.
        await user.save();

        const { token, refreshToken } = await issueAuthTokens(user);
        setRefreshCookie(res, refreshToken);

        // The same question the password login answers: does this email hold an
        // account on the OTHER side? Without this, every Google sign-in landed
        // on whichever side the button happened to be on and never offered the
        // choice. Google has verified the address, so existence may be
        // disclosed on the same footing as a verified password login.
        // sameCredentials here means "the same Google identity also owns that
        // account", so re-running Google against that side signs them in
        // without a password; otherwise that account has its own credentials.
        let otherSide = null;
        const ownType = User.accountTypeForRole(user.role);
        const otherType = ownType === 'business' ? 'customer' : 'business';
        const others = await User.find({
            email: user.email, _id: { $ne: user._id },
            role: User.roleFilterForAccountType(otherType),
        });
        const reachable = others.filter((o) => !(o.isActive === false && !o.deactivatedAt));
        if (reachable.length) {
            const sameIdentity = !!user.googleId && reachable.some((o) => o.googleId === user.googleId);
            otherSide = { accountType: otherType, sameCredentials: sameIdentity };
        }

        res.status(200).json({
            success: true,
            data: {
                token,
                refreshToken,
                user: {
                    _id: user._id,
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    avatar: user.avatar,
                    phone: user.phone,
                    providerCategory: user.providerCategory,
                    providerSetupComplete: user.providerSetupComplete,
                },
                otherSide,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Authentication failed' });
    }
};

/**
 * =========================
 * REFRESH ACCESS TOKEN
 * =========================
 * Exchanges a valid refresh token for a fresh access token (and rotates the
 * refresh token). This is what keeps people signed in: when the short-lived
 * access token expires the client silently refreshes instead of logging out.
 * Refresh tokens carry the user's tokenVersion, so logout / password reset
 * (which bump tokenVersion) revoke them too.
 */
exports.refresh = async (req, res) => {
    try {
        // Body token from the app's own storage, or the SSO cookie set by a
        // login on a sibling subdomain (spec §8).
        const refreshToken = req.body?.refreshToken || readRefreshCookie(req);
        if (!refreshToken) {
            return res.status(400).json({ success: false, message: 'Refresh token required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
        }

        const user = await User.findById(decoded.id).select('+refreshTokenJtis');
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid refresh token' });
        }

        if (user.isActive === false) {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

        // App-scoped sessions: each app sends its accountType so the SSO cookie
        // from a sibling-subdomain login can only bootstrap a session for the
        // matching side — the business app never silently adopts a customer
        // session (and vice versa). Legacy clients omit it and keep old behavior.
        const { accountType } = req.body || {};
        if ((accountType === 'customer' || accountType === 'business') &&
            User.accountTypeForRole(user.role) !== accountType) {
            return res.status(403).json({
                success: false,
                message: `This session belongs to a ${User.accountTypeForRole(user.role)} account.`,
            });
        }

        // Revoked by a logout / password reset since this refresh token was issued
        if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion) {
            return res.status(401).json({ success: false, message: 'Refresh token has been revoked' });
        }

        // Reuse / rotation check: a tracked account only accepts a refresh token
        // whose jti is still in its valid list. A token that was already rotated
        // away (or forged) won't be there, so it's rejected. Tokens predating this
        // feature carry no jti and the account has no list yet — those are allowed
        // through (legacy grace) until their first rotation starts tracking them.
        if (Array.isArray(user.refreshTokenJtis) && user.refreshTokenJtis.length > 0) {
            if (!decoded.jti || !user.refreshTokenJtis.includes(hashJti(decoded.jti))) {
                return res.status(401).json({ success: false, message: 'Refresh token has been revoked' });
            }
            // Race-tolerant rotation (spec §4.3): the presented jti is NOT
            // consumed — two tabs (or two apps sharing the SSO cookie) that
            // refresh with the same token both succeed instead of revoking
            // each other. Old tokens age out of the capped list as new ones
            // are issued; logout/password-change still revokes everything at
            // once via tokenVersion + clearing the list.
        }

        const { token, refreshToken: newRefreshToken } = await issueAuthTokens(user);
        setRefreshCookie(res, newRefreshToken);

        res.status(200).json({
            success: true,
            data: { token, refreshToken: newRefreshToken }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * =========================
 * LOGOUT
 * =========================
 */
exports.logout = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 }, $set: { refreshTokenJtis: [] } });
        clearRefreshCookie(res);
        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Logout failed' });
    }
};

/**
 * =========================
 * GET PROFILE
 * =========================
 */
exports.getProfile = async (req, res) => {
    try {
        // Exclude the live email-verification credential from the profile response.
        // password / refreshTokenJtis / oauthCode / passwordResetToken are already
        // select:false, but verificationToken is NOT — returning it let an
        // authenticated user read a reusable self-verification token (finding #27).
        const user = await User.findById(req.user.id).select('-verificationToken -verificationTokenExpiry');

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Record the one-time post-signup friction survey ("Did you experience any
 * difficulties signing up?"). Writing sets the nullable signupSurvey subdoc,
 * which hides the in-app prompt from then on. Safe to overwrite.
 */
exports.submitSignupSurvey = async (req, res) => {
    try {
        // Either the user answered, or dismissed. Both clear signupSurveyPending so
        // the one-time prompt never reappears (across devices), but a dismissal
        // stores no survey row so admins don't see a fake "no issues" answer.
        const update = { signupSurveyPending: false };
        if (!req.body.dismissed) {
            const hadDifficulty = !!req.body.hadDifficulty;
            const comment = typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';
            update.signupSurvey = { hadDifficulty, comment, submittedAt: new Date() };
        }
        const user = await User.findByIdAndUpdate(
            req.user.id, update, { new: true, runValidators: true }
        ).select('signupSurvey signupSurveyPending');
        res.status(200).json({ success: true, data: user?.signupSurvey || null });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * =========================
 * UPDATE PROFILE
 * =========================
 */
exports.updateProfile = async (req, res) => {
    try {
        const { name, phone, avatar, providerCategory, address } = req.body;

        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.name = name || user.name;
        user.phone = phone || user.phone;
        user.avatar = avatar || user.avatar;
        if (req.body.googleCalendarEmbedUrl !== undefined) user.googleCalendarEmbedUrl = req.body.googleCalendarEmbedUrl.trim();

        if (user.role === 'provider' && address !== undefined) {
            user.businessProfile.address = address.trim();
        }

        // Map-pin coordinates (onboarding step 1). Accept {lat,lng} or null to
        // clear; reject out-of-range values so a bad pin can't corrupt search.
        if (user.role === 'provider' && req.body.coordinates !== undefined) {
            const c = req.body.coordinates;
            if (!user.businessProfile) user.businessProfile = {};
            if (c === null) {
                user.businessProfile.coordinates = { lat: null, lng: null };
            } else if (c && typeof c === 'object') {
                const lat = Number(c.lat);
                const lng = Number(c.lng);
                if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                    return res.status(400).json({ success: false, message: 'Invalid map coordinates' });
                }
                user.businessProfile.coordinates = { lat, lng };
            }
            user.markModified('businessProfile');
        }

        // Let providers rename their business after onboarding — this is the name shown
        // in search and on cards (falls back to their personal name when blank).
        if (user.role === 'provider' && req.body.businessName !== undefined) {
            if (typeof req.body.businessName !== 'string') {
                return res.status(400).json({ success: false, message: 'Business name must be a string' });
            }
            if (!user.businessProfile) user.businessProfile = {};
            user.businessProfile.businessName = req.body.businessName.trim();
            user.markModified('businessProfile');
        }

        // Currency the business prices in (chosen at onboarding; editable later).
        if (user.role === 'provider' && req.body.currency !== undefined) {
            const code = String(req.body.currency).toUpperCase().trim();
            if (!CURRENCY_CODES.includes(code)) {
                return res.status(400).json({ success: false, message: 'Unsupported currency' });
            }
            if (!user.businessProfile) user.businessProfile = {};
            user.businessProfile.currency = code;
            user.markModified('businessProfile');
        }

        // Short business tagline (shown on discovery cards + public profile).
        if (user.role === 'provider' && req.body.description !== undefined) {
            if (typeof req.body.description !== 'string') {
                return res.status(400).json({ success: false, message: 'Description must be a string' });
            }
            if (!user.businessProfile) user.businessProfile = {};
            user.businessProfile.description = req.body.description.trim().slice(0, 200);
            user.markModified('businessProfile');
        }

        if (user.role === 'provider' && providerCategory !== undefined) {
            if (!MAIN_CATEGORIES.includes(providerCategory)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please select a valid provider category'
                });
            }
            user.providerCategory = providerCategory;
        }

        // Cancellation notice window (hours). 0 = clients may cancel anytime.
        if (user.role === 'provider' && req.body.cancellationWindowHours !== undefined) {
            const hours = Number(req.body.cancellationWindowHours);
            if (!Number.isInteger(hours) || hours < 0 || hours > 168) {
                return res.status(400).json({ success: false, message: 'Cancellation window must be a whole number of hours between 0 and 168' });
            }
            if (!user.bookingPolicy) user.bookingPolicy = {};
            user.bookingPolicy.cancellationWindowHours = hours;
            user.markModified('bookingPolicy');
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Upgrade the CURRENT account to also be a provider — no second signup.
 * One account can be both a customer and a provider; this just flips the role
 * (auth loads the role fresh each request, so it takes effect immediately) and
 * seeds default availability so the calendar works right away.
 */
exports.becomeProvider = async (req, res) => {
    try {
        const { providerCategory } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role === 'admin') {
            return res.status(400).json({ success: false, message: 'Admin accounts cannot become providers' });
        }
        // A staff member belongs to a business owner's roster; letting them self-upgrade
        // to a full provider would escape the owner's control and mint a merchant account
        // outside onboarding (finding #20). Only a plain customer may become a provider.
        if (user.role === 'staff' || user.staffOf) {
            return res.status(403).json({ success: false, message: 'Staff accounts cannot upgrade to a provider. Ask your business owner.' });
        }
        // This handler now CREATES a second document instead of flipping the
        // caller's role, so a caller already on the business side would sail
        // past the existingBusiness guard below (which excludes their own doc)
        // and collide with the {email, accountType} unique index — a 500. Refuse
        // it here with a clear message.
        if (user.role !== 'customer') {
            return res.status(400).json({
                success: false,
                message: 'This account is already a business account — sign in to it on the business app.',
            });
        }
        if (!providerCategory || !providerCategory.trim()) {
            return res.status(400).json({ success: false, message: 'Please choose your main service category' });
        }

        // One email may hold one account per side, so a business account already
        // on this email has nowhere to go.
        const existingBusiness = await User.findOne({
            email: user.email,
            _id: { $ne: user._id },
            role: User.roleFilterForAccountType('business'),
        });
        if (existingBusiness) {
            return res.status(400).json({
                success: false,
                message: 'A business account with this email already exists — sign in to it on the business app instead.',
            });
        }

        // ADD a business account; never convert the customer account they are
        // signed into. Flipping the role in place (what this used to do) left
        // the person with no customer profile at all: their bookings, wallet and
        // reviews stayed on a document the customer site would no longer sign
        // in, and there was no way back. Two documents is what the rest of the
        // system already assumes — the {email, accountType} index exists exactly
        // so one person can be both.
        const withPassword = await User.findById(user._id).select('+password');
        // Social identity is carried by googleId, NOT the `provider` field:
        // passport creates Google users with googleId set and provider left at
        // its schema default 'local' (it never writes provider:'google'). Keying
        // this off `provider` made it always false in production, so the new
        // business account got no googleId and an unknown random password —
        // unreachable by Google OR password. Detect via googleId.
        const googleId = user.googleId || null;
        const business = await User.create({
            name: user.name,
            email: user.email,
            // When the source HAS a password we set a throwaway placeholder here
            // and overwrite it below with the source's real hash (passing the
            // already-hashed value into create() would double-hash it). A
            // Google-only account has no password to copy, so it gets none and
            // signs in with Google — leaving the placeholder would strand an
            // unknown local password on the account.
            password: withPassword?.password ? `${crypto.randomBytes(24).toString('hex')}Aa1!` : undefined,
            phone: user.phone,
            role: 'provider',
            providerCategory: providerCategory.trim().slice(0, 100),
            avatar: user.avatar,
            // They already proved this address on the customer side; making them
            // verify the same inbox twice would strand the new account.
            isVerified: user.isVerified,
            provider: user.provider || 'local',
            // Copy the Google identity so passport's business-side googleId
            // lookup hits this document and lands them in the business app.
            googleId,
        });
        // Copy the password whenever the source has one (a Google account that
        // also set a local password keeps both), so the website can carry them
        // across silently. A Google-only account has no password here — it signs
        // in with Google, which now resolves to this document via googleId.
        if (withPassword?.password) {
            await User.updateOne({ _id: business._id }, { $set: { password: withPassword.password } });
        }

        // Seed a default weekly schedule so the provider's calendar is usable immediately
        const Availability = require('../models/Availability');
        const exists = await Availability.findOne({ provider: business._id });
        if (!exists) {
            const open = { enabled: true, slots: [{ start: '09:00', end: '17:00' }] };
            const closed = { enabled: false, slots: [{ start: '09:00', end: '17:00' }] };
            await Availability.create({
                provider: business._id,
                schedule: { monday: open, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: closed, sunday: closed },
            });
        }

        // A one-time code so they land in the business app already signed in.
        // Safe by construction: the server just created this account for this
        // authenticated user on their own email — there is no pre-existing
        // account here to hijack (the guard above refuses that case).
        const handoffCode = crypto.randomBytes(32).toString('hex');
        await User.updateOne({ _id: business._id }, {
            $set: {
                oauthCode: crypto.createHash('sha256').update(handoffCode).digest('hex'),
                oauthCodeExpiry: new Date(Date.now() + 10 * 60 * 1000),
            },
        });

        res.status(200).json({
            success: true,
            message: 'Your business is set up — welcome aboard!',
            data: {
                id: business._id,
                name: business.name,
                email: business.email,
                role: business.role,
                accountType: 'business',
                providerCategory: business.providerCategory,
                // The customer account is untouched and still signed in on this
                // origin; the client uses this code to open the business app.
                handoffCode,
            },
        });
    } catch (error) {
        // Two become-provider calls racing for the same email: the compound
        // unique index catches what the findOne pre-check missed — report it as
        // the same 400 rather than a bare 500.
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A business account with this email already exists — sign in to it on the business app instead.',
            });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Two accounts on one email are the SAME person only when we can prove it:
// the same Google identity, or a byte-identical password hash (bcrypt salts per
// hash, so an identical hash can only be a become-provider/add-customer clone —
// never two people who happened to choose the same password). Anything else is
// two independent accounts that merely share an address, and switching between
// them must go through that account's own sign-in.
const sameIdentity = (a, b) =>
    (!!a.googleId && a.googleId === b.googleId)
    || (!!a.password && !!b.password && a.password === b.password);

// Mint a one-time code the other origin exchanges for a session (same mechanism
// as the Google callback). Caller must already own the target document.
const mintHandoffCode = async (userId) => {
    const code = crypto.randomBytes(32).toString('hex');
    await User.updateOne({ _id: userId }, {
        $set: {
            oauthCode: crypto.createHash('sha256').update(code).digest('hex'),
            oauthCodeExpiry: new Date(Date.now() + 10 * 60 * 1000),
        },
    });
    return code;
};

/**
 * GET /auth/sibling — does the signed-in user hold an account on the OTHER side,
 * and can we carry them across without a fresh sign-in? Drives the account
 * switcher in both navbars. Only ever tells the authenticated caller about their
 * OWN email, so it reveals nothing they couldn't already learn by signing in.
 */
exports.getSibling = async (req, res) => {
    try {
        const me = await User.findById(req.user.id).select('+password');
        if (!me) return res.status(404).json({ success: false, message: 'User not found' });
        const otherType = User.accountTypeForRole(me.role) === 'business' ? 'customer' : 'business';
        const siblings = await User.find({
            email: me.email, _id: { $ne: me._id },
            role: User.roleFilterForAccountType(otherType),
        }).select('+password');
        // A dead-end account (admin-suspended) is not offered.
        const sibling = siblings.find((s) => !(s.isActive === false && !s.deactivatedAt));
        res.status(200).json({
            success: true,
            data: sibling
                ? { accountType: otherType, name: sibling.name, sameCredentials: sameIdentity(me, sibling) }
                : null,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /auth/switch-side — hand the signed-in user to their EXISTING account on
 * the other side, already signed in. Only mints a session when the two accounts
 * are provably the same identity (see sameIdentity); otherwise the client must
 * send them to that account's own sign-in, because being logged into one side is
 * not proof of owning an independently-credentialed account on the same email
 * (registration does not verify the address).
 */
exports.switchSide = async (req, res) => {
    try {
        const me = await User.findById(req.user.id).select('+password');
        if (!me) return res.status(404).json({ success: false, message: 'User not found' });
        const otherType = User.accountTypeForRole(me.role) === 'business' ? 'customer' : 'business';
        const siblings = await User.find({
            email: me.email, _id: { $ne: me._id },
            role: User.roleFilterForAccountType(otherType),
        }).select('+password');
        const sibling = siblings.find((s) => !(s.isActive === false && !s.deactivatedAt));
        if (!sibling) {
            return res.status(404).json({ success: false, message: 'No account on the other side' });
        }
        if (!sameIdentity(me, sibling)) {
            // Different sign-in — the client sends them to that account's login.
            return res.status(409).json({ success: false, message: 'sign_in_required', accountType: otherType });
        }
        const handoffCode = await mintHandoffCode(sibling._id);
        res.status(200).json({ success: true, data: { accountType: otherType, handoffCode } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /auth/add-customer-account — the business-side mirror of becomeProvider.
 * A business owner adds a personal customer account on their own email so they
 * can book as themselves, and lands on the customer site already signed in. Safe
 * by construction: the server creates it for this authenticated user on their
 * own address, so there is no pre-existing account to hijack (the guard refuses
 * that case), and it copies the caller's own identity across.
 */
exports.addCustomerAccount = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role === 'customer') {
            return res.status(400).json({ success: false, message: 'This is already a customer account.' });
        }
        const existingCustomer = await User.findOne({
            email: user.email, _id: { $ne: user._id },
            role: User.roleFilterForAccountType('customer'),
        });
        if (existingCustomer) {
            return res.status(400).json({
                success: false,
                message: 'A customer account with this email already exists — switch to it instead.',
            });
        }

        const withPassword = await User.findById(user._id).select('+password');
        const customer = await User.create({
            name: user.name,
            email: user.email,
            // Placeholder only when there is a real hash to copy (see becomeProvider);
            // a Google-only owner gets no password and signs in with Google.
            password: withPassword?.password ? `${crypto.randomBytes(24).toString('hex')}Aa1!` : undefined,
            phone: user.phone,
            role: 'customer',
            avatar: user.avatar,
            isVerified: user.isVerified,
            provider: user.provider || 'local',
            googleId: user.googleId || null,
        });
        if (withPassword?.password) {
            await User.updateOne({ _id: customer._id }, { $set: { password: withPassword.password } });
        }

        const handoffCode = await mintHandoffCode(customer._id);
        res.status(200).json({
            success: true,
            message: 'Your customer account is ready.',
            data: { id: customer._id, accountType: 'customer', handoffCode },
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A customer account with this email already exists — switch to it instead.',
            });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }
        const user = await User.findById(req.user.id).select('+password');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (!user.password) {
            return res.status(400).json({ success: false, message: 'This account uses Google sign-in — no password to change' });
        }
        const isMatch = await user.matchPassword(currentPassword);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/.test(newPassword);
        if (newPassword.length < 8 || !passwordRegex) {
            return res.status(400).json({ success: false, message: 'New password must be at least 8 characters and include an uppercase letter, a number and a special character' });
        }
        // becomeProvider copies this account's password HASH onto the business
        // twin so the website can carry them across. Nothing on this side ever
        // re-touched that copy, so the old password kept opening the twin after
        // a change here. bcrypt salts per hash, so a byte-identical hash on
        // another document can ONLY be that clone — never a user who happened to
        // pick the same password twice — which makes the match exact and safe.
        const oldHash = user.password;
        user.password = newPassword;
        // Invalidate all existing sessions (access + refresh tokens carry tokenVersion),
        // so changing the password signs out other devices — same as a reset.
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.refreshTokenJtis = []; // drop tracked refresh tokens too
        await user.save();
        // save() has re-hashed, so user.password is the NEW hash — mirror it onto
        // the cloned twin and revoke its sessions too.
        await User.updateOne(
            { email: user.email, _id: { $ne: user._id }, password: oldHash },
            { $set: { password: user.password, refreshTokenJtis: [] }, $inc: { tokenVersion: 1 } },
        );
        res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * Self-service account deactivation (reversible). Blocks sign-in and revokes
 * sessions; the next successful login reactivates the account.
 */
exports.deactivateAccount = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, {
            $set: { isActive: false, deactivatedAt: new Date() },
            $inc: { tokenVersion: 1 },
        });
        res.status(200).json({ success: true, message: 'Your account has been deactivated. Sign in again any time to reactivate it.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * Self-service account deletion (irreversible). We anonymise personal data and
 * disable sign-in rather than hard-deleting the row, so existing bookings keep
 * their integrity. Local accounts must confirm with their password.
 */
exports.deleteAccount = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('+password');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.password) {
            const ok = req.body.password && await user.matchPassword(req.body.password);
            if (!ok) return res.status(401).json({ success: false, message: 'Password is incorrect' });
        }

        // Cancel the user's upcoming appointments (whether they're the customer or
        // the provider), release any held wallet funds, and notify the other party.
        // Wrapped so a cleanup hiccup can never block the deletion itself.
        try {
            const Appointment = require('../models/Appointment');
            const walletService = require('../utils/walletService');
            const { createNotification } = require('../utils/notificationhelper');
const { ApptPhrase } = require('../utils/apptCopy');
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const upcoming = await Appointment.find({
                $or: [{ customer: user._id }, { provider: user._id }],
                status: { $in: ['pending', 'confirmed'] },
                appointmentDate: { $gte: today },
            }).populate('service', 'name');
            for (const appt of upcoming) {
                appt.status = 'cancelled';
                appt.cancellationReason = 'Account closed';
                appt.statusHistory.push({ status: 'cancelled', changedBy: user._id });
                await appt.save();
                try { await walletService.releaseReservation({ appointmentId: appt._id, resolvedBy: user._id }); } catch (_) {}
                const otherId = appt.customer?.toString() === user._id.toString() ? appt.provider : appt.customer;
                if (otherId) {
                    createNotification(otherId, `${ApptPhrase(appt.service?.name)} was cancelled because the other party closed their account.`, 'appointment', '/appointments');
                }
            }
        } catch (cleanupErr) {
            console.error('Account deletion cleanup failed:', cleanupErr.message);
        }

        const anonEmail = `deleted_${crypto.randomBytes(8).toString('hex')}@deleted.bookplus`;
        await User.updateOne({ _id: user._id }, {
            $set: {
                name: 'Deleted user', email: anonEmail, phone: 'deleted',
                avatar: null, googleId: null, isActive: false, deletedAt: new Date(),
                favorites: [], blockedUsers: [],
            },
            $unset: { password: '', refreshTokenJtis: '', verificationToken: '', passwordResetToken: '' },
            $inc: { tokenVersion: 1 },
        });

        // A deleted provider should no longer appear in the marketplace.
        if (user.role === 'provider') {
            try { await require('../models/Service').updateMany({ provider: user._id }, { isActive: false }); } catch (_) {}
        }

        res.status(200).json({ success: true, message: 'Your account has been deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/** Block another user — prevents bookings and messaging in both directions. */
exports.blockUser = async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId || userId.toString() === req.user._id.toString()) {
            return res.status(400).json({ success: false, message: 'Invalid user' });
        }
        const target = await User.findById(userId).select('_id');
        if (!target) return res.status(404).json({ success: false, message: 'User not found' });
        await User.findByIdAndUpdate(req.user._id, { $addToSet: { blockedUsers: userId } });
        res.status(200).json({ success: true, message: 'User blocked' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/** Unblock a previously blocked user. */
exports.unblockUser = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { $pull: { blockedUsers: req.params.userId } });
        res.status(200).json({ success: true, message: 'User unblocked' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/** List the users the current account has blocked. */
exports.getBlockedUsers = async (req, res) => {
    try {
        const me = await User.findById(req.user._id).populate('blockedUsers', 'name avatar role');
        res.status(200).json({ success: true, data: me?.blockedUsers || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updatePortfolio = async (req, res) => {
    try {
        const { images, instagramUrl } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.portfolio) user.portfolio = {};
        if (Array.isArray(images)) user.portfolio.images = images.slice(0, 30); // cap at 30 images
        if (instagramUrl !== undefined) user.portfolio.instagramUrl = instagramUrl.trim();

        user.markModified('portfolio');
        await user.save();
        res.status(200).json({ success: true, data: user.portfolio });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.completeProviderSetup = async (req, res) => {
    try {
        const { businessName, teamSize, locationType, address, currentSoftware, referralSource } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role !== 'provider') return res.status(403).json({ success: false, message: 'Providers only' });

        if (!user.businessProfile) user.businessProfile = {};
        user.businessProfile.businessName = (businessName || '').trim();
        user.businessProfile.teamSize = teamSize || '';
        user.businessProfile.locationType = locationType || '';
        user.businessProfile.address = (address || '').trim();
        user.businessProfile.currentSoftware = (currentSoftware || '').trim();
        user.businessProfile.referralSource = referralSource || '';
        user.providerSetupComplete = true;

        user.markModified('businessProfile');
        await user.save();
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /api/auth/booking-slug
 * Auth (provider) — return the provider's public booking-link handle, creating
 * a unique one from the business name on first call. Idempotent: repeat calls
 * return the same slug.
 */
exports.generateBookingSlug = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role !== 'provider') {
            return res.status(403).json({ success: false, message: 'Only businesses have a booking link' });
        }

        if (!user.businessProfile) user.businessProfile = {};
        if (!user.businessProfile.slug) {
            const { generateUniqueSlug } = require('../utils/slug');
            const base = user.businessProfile.businessName || user.name;
            user.businessProfile.slug = await generateUniqueSlug(base, user._id);
            user.markModified('businessProfile');
            await user.save();
        }

        res.status(200).json({ success: true, data: { slug: user.businessProfile.slug } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.verifyEmail = async (req, res) => {
    // A business signup must return to the business app, not the customer site.
    // Success knows the real account role; the error cases (no user yet) fall
    // back to the `app` hint the verification link carries.
    const hintOrigin = req.query.app === 'business' ? businessOrigin() : primaryOrigin();
    try {
        const { token } = req.query;

        if (!token) {
            return res.redirect(`${hintOrigin}/verify-email?status=invalid`);
        }

        const user = await User.findOne({
            verificationToken: token,
            verificationTokenExpiry: { $gt: new Date() },
        });

        if (!user) {
            return res.redirect(`${hintOrigin}/verify-email?status=expired`);
        }

        user.isVerified = true;
        user.verificationToken = null;
        user.verificationTokenExpiry = null;
        await user.save();

        // Send role-specific welcome email (fire-and-forget — must not block the redirect)
        sendWelcomeEmail(user.email, user.name, user.role).catch(() => {});

        return res.redirect(`${originForRole(user.role)}/verify-email?status=success&role=${user.role}`);
    } catch (error) {
        return res.redirect(`${hintOrigin}/verify-email?status=error`);
    }
};

/**
 * POST /api/auth/forgot-password
 * Sends a password reset email. Always responds with 200 to prevent user enumeration.
 */
exports.forgotPassword = async (req, res) => {
    try {
        const { email, accountType } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        // Scoped to the requesting app's account type when provided, so the
        // reset link targets the right one of a dual (customer + business)
        // email. Without it, every matching local account gets its own link.
        const query = { email: email.toLowerCase().trim() };
        if (accountType === 'customer' || accountType === 'business') {
            query.role = User.roleFilterForAccountType(accountType);
        }
        const users = await User.find(query).select('+passwordResetToken +passwordResetExpiry');
        const { sendPasswordResetEmail } = require('../utils/emailService');

        for (const user of users) {
            if (user.provider !== 'local') continue;
            // Generate a secure random token; store only its SHA-256 hash
            const rawToken = crypto.randomBytes(32).toString('hex');
            user.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
            user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
            await user.save({ validateBeforeSave: false });
            // Fire-and-forget, exactly like every other outbound email here. Awaiting
            // the send made a HIT measurably slower than a MISS, so the response time
            // leaked whether the address was registered even though the body is
            // deliberately generic (finding #23).
            sendPasswordResetEmail(user.email, user.name, rawToken, user.role)
                .catch((err) => console.error('Password reset email failed:', err.message));
        }

        // Always the same response so attackers cannot enumerate registered emails
        return res.status(200).json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /api/auth/reset-password
 * Verifies the token and sets a new password.
 */
exports.resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ success: false, message: 'Token and new password are required' });
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters and include an uppercase letter, a number and a special character'
            });
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpiry: { $gt: new Date() },
        }).select('+password +passwordResetToken +passwordResetExpiry');

        if (!user) {
            return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired' });
        }

        // See changePassword: becomeProvider clones this hash onto the business
        // twin, and only matching on the exact old hash (bcrypt salts per hash)
        // reaches that clone without touching genuinely independent accounts.
        const oldHash = user.password;
        user.password = password;
        user.passwordResetToken = null;
        user.passwordResetExpiry = null;
        // Invalidate all existing sessions
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.refreshTokenJtis = []; // drop tracked refresh tokens too
        await user.save();
        if (oldHash) {
            await User.updateOne(
                { email: user.email, _id: { $ne: user._id }, password: oldHash },
                { $set: { password: user.password, refreshTokenJtis: [] }, $inc: { tokenVersion: 1 } },
            );
        }

        return res.status(200).json({ success: true, message: 'Password reset successfully. You can now sign in.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};