const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { sendWelcomeEmail } = require('../utils/emailService');
const { roleFromState } = require('../utils/oauthState');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.SERVER_URL}/api/auth/google/callback`,
    passReqToCallback: true,
}, async (req, accessToken, refreshToken, profile, done) => {
    try {
        // Role is carried through the OAuth `state` param set when the flow began
        // (the "Continue with Google" button passes the chosen role). It also
        // determines WHICH side's account this sign-in targets: one Google
        // identity may hold both a customer and a business account, so every
        // lookup below is scoped to the requested account type.
        // `state` is now "<role>.<nonce>" (the nonce is the CSRF binding verified in
        // authRoutes before we ever get here), so the role must be parsed out rather
        // than compared whole — a raw === 'provider' would now always miss.
        const requestedRole = roleFromState(req.query.state);
        const roleFilter = User.roleFilterForAccountType(User.accountTypeForRole(requestedRole));

        let user = await User.findOne({ googleId: profile.id, role: roleFilter });

        if (!user) {
            const email = profile.emails[0].value;
            // Whether Google actually verified this address. Adopting an existing
            // local account off an UNVERIFIED Google email is an account-takeover
            // vector, so we never do it.
            const googleVerified = profile.emails[0].verified === true
                || profile.emails[0].verified === 'true'
                || profile._json?.email_verified === true;

            const existing = await User.findOne({ email, role: roleFilter });
            if (existing) {
                // Can't prove this Google user owns the mailbox → refuse to link.
                if (!googleVerified) return done(null, false);

                existing.googleId = profile.id;
                if (!existing.avatar) existing.avatar = profile.photos[0]?.value;
                // A pre-existing UNVERIFIED local account on this email may be an
                // attacker who pre-registered on the victim's address (local register
                // issues tokens without proving mailbox ownership, and isVerified
                // gates nothing). Google has now proved the person signing in controls
                // the mailbox, so we take the account over — but burn any pre-set
                // password and revoke existing sessions (tokenVersion bump + clear
                // refresh jtis) so the pre-registrant can't ride the merged account.
                // An already-verified account is a genuine owner adding Google as a
                // second sign-in; leave its credentials untouched.
                if (!existing.isVerified) {
                    existing.isVerified = true;
                    existing.password = crypto.randomBytes(32).toString('hex'); // unknown to anyone → disables password login
                    existing.tokenVersion = (existing.tokenVersion || 0) + 1;
                    existing.refreshTokenJtis = [];
                }
                await existing.save();
                user = existing;
            } else {
                user = await User.create({
                    name: profile.displayName,
                    email: profile.emails[0].value,
                    googleId: profile.id,
                    avatar: profile.photos[0]?.value || null,
                    phone: 'pending',
                    role: requestedRole,
                    password: undefined,
                    isVerified: true,
                    consentedAt: new Date(), // consent gated on the "Continue with Google" button
                });
                // Welcome email for new social sign-ups (providers and customers alike)
                sendWelcomeEmail(user.email, user.name, user.role).catch(() => {});
            }
        }
        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}));

module.exports = passport;