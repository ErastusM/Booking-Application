const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: [true, 'Please add a description']
        },
        price: {
            type: Number,
            required: [true, 'Please add a price']
        },
        duration: {
            type: Number,
            required: [true, 'Please add duration in minutes'],
            default: 30
        },
        /* Buffer minutes blocked off around each booking (cleanup/prep) */
        bufferBefore: { type: Number, default: 0, min: 0, max: 120 },
        bufferAfter:  { type: Number, default: 0, min: 0, max: 120 },
        image: {
            type: String,
            default: null
        },
        provider: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null, // null = global admin service, set = provider's own service
        },
        location: {
            type: String,
            default: '',
        },
        address: {
            type: String,
            default: '',
        },
        isActive: {
            type: Boolean,
            default: true
        },

        /* Does the OWNER perform this service themselves?
         *
         * The owner is a professional like any team member — clients see them as
         * their own tile once the business has a roster — but they have no
         * TeamMember row, so what they offer has to live somewhere. It lives here,
         * per service, and is the owner's equivalent of TeamMember.services.
         *
         *   true   → the owner offers it, at this Service's price and duration
         *   false  → only the team members who list it offer it; it never appears
         *            under the owner, and nobody can book the owner for it
         *   absent → rows from before this field: read as TRUE (utils/staffBooking
         *            ownerPerforms), so deploying changes nothing on its own
         *
         * Deliberately NO schema default: a default would be written back onto a
         * legacy row the first time anything saved it, turning "not decided yet"
         * into a decision nobody made, and hiding it from
         * scripts/migrate_owner_performs.js.
         *
         * Written true by the catalogue (the owner's own menu), false by a team
         * member's "add a service I offer" (and the owner's "add a service <member>
         * offers"), and changed only by the owner or an admin. */
        ownerPerforms: {
            type: Boolean,
        },

        createdBy: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: true
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null,
        },
        addOns: {
            type: [{
                name: { type: String, required: true },
                price: { type: Number, required: true },
                duration: { type: Number, default: 0 },
            }],
            default: [],
        },
        /* Mutually exclusive sub-options (e.g. Adults / Students / Trim & Beard).
           If present, the customer must pick exactly one before booking. */
        options: {
            type: [{
                name:        { type: String, required: true },
                description: { type: String, default: '' },
                price:       { type: Number, required: true },
                duration:    { type: Number, required: true },
            }],
            default: [],
        },
    },
    {
        timestamps: true
    }
);

serviceSchema.index({ provider: 1, isActive: 1 });
serviceSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Service', serviceSchema);
