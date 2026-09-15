// Granular service categories used for provider signup and the marketplace
// category filter. Kept as a flat list because providerCategory is a single value.
//
// ALPHABETICAL on purpose, with 'Other' pinned last. This list is rendered in
// array order by the provider-signup picker and the marketplace filter, so any
// THEMATIC grouping necessarily front-loads whichever vertical is placed first —
// it previously opened with nine consecutive hair/beauty entries, which made a
// universal booking platform read as a salon directory to every other trade.
// Alphabetical privileges no vertical and scans better in a 26-option select.
//
// Keep all three copies byte-identical: apps/customer, apps/business, apps/api.
const MAIN_CATEGORIES = [
    'Automotive',
    'Barbering',
    'Cleaning',
    'Counseling & therapy',
    'Dental',
    'Events & rentals',
    'Eyebrows & eyelashes',
    'Facials & skincare',
    'Fitness & training',
    'Hair & styling',
    'Hair removal',
    'Holistic health',
    'Home services',
    'Makeup',
    'Massage & spa',
    'Medical',
    'Nails',
    'Nutrition & diet',
    'Optical',
    'Pet grooming',
    'Photography & video',
    'Physical therapy',
    'Tattoo & piercing',
    'Tutoring & education',
    'Veterinary',
    'Other',
];

module.exports = MAIN_CATEGORIES;
