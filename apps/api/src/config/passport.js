const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { sendWelcomeEmail } = require('../utils/emailService');

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
        const requestedRole = req.query.state === 'provider' ? 'provider' : 'customer';
        const roleFilter = User.roleFilterForAccountType(User.accountTypeForRole(requestedRole));

        let user = await User.findOne({ googleId: profile.id, role: roleFilter });

        if (!user) {
            user = await User.findOne({ email: profile.emails[0].value, role: roleFilter });
            if (user) {
                user.googleId = profile.id;
                if (!user.avatar) user.avatar = profile.photos[0]?.value;
                await user.save();
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