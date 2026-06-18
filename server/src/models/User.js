const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const MAIN_CATEGORIES = require('../constants/mainCategories');

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
            unique: true,
            lowercase: true,
            match: [
                /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
                'Please provide a valid email'
            ]
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
            enum: ['customer', 'provider', 'admin'],
            default: 'customer'
        },
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
        consentedAt: { type: Date, default: null }, // when the user accepted Terms + Privacy Policy
        providerSetupComplete: { type: Boolean, default: false },
        googleCalendarEmbedUrl: { type: String, default: '' },
        businessProfile: {
            businessName: { type: String, default: '' },
            teamSize: { type: String, default: '' },
            locationType: { type: String, default: '' },
            address: { type: String, default: '' },
            currentSoftware: { type: String, default: '' },
            referralSource: { type: String, default: '' },
        },
        portfolio: {
            images: [{ type: String }],
            instagramUrl: { type: String, default: '' },
        },
        // Providers this user has saved (customer-facing favorites)
        favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        oauthCode: { type: String, default: null, select: false },
        oauthCodeExpiry: { type: Date, default: null, select: false },
        passwordResetToken: { type: String, default: null, select: false },
        passwordResetExpiry: { type: Date, default: null, select: false },
    },
    {
        timestamps: true
    }
);

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
