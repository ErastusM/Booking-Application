// Bookplus Privacy Policy: the ONE source for both apps.
//   customer app (www / app.bookplus.pro)  -> privacyPolicy('customer')
//   business app (business.bookplus.pro)   -> privacyPolicy('business')
// Most sections are shared; a few paragraphs differ by audience.
//
// Every statement here must match what the code does. When you change what the
// platform collects, who it shares with or how long it keeps things, change this
// file in the same pull request. The code each claim rests on is noted beside it.
//
// Written to a standard compatible with the Namibian Data Protection Bill (not
// yet in force), South Africa's POPIA and the EU/UK GDPR, because sign-up is
// open to anyone. This is not legal advice; have it reviewed by counsel.
//
// Text format (rendered by LegalDocument in @bookplus/ui):
//   a string                      -> paragraph; **bold**, [link](/path or mailto:)
//   { list: [...] }               -> bulleted list
//   { table: { head, rows } }     -> table (stacks into cards on phones)
//   { note: '...' }               -> highlighted note
//   { company: true }             -> the operator's details from company.mjs

import { COMPANY, operatorName, companyValue, mailLink } from './company.mjs';

export const PRIVACY_LAST_UPDATED = '26 September 2026';

// Retention periods. Where the code already fixes a period, that value wins and
// the source is named; keep these in step with the retention job's constants.
export const RETENTION = {
    analyticsEvents: '180 days', // apps/api/src/models/Event.js TTL index (180 days)
    errorLogs: '90 days',
    bookingRejections: '7 days', // apps/api/src/models/BookingRejection.js TTL index
    backups: '14 days', // ops/backup/backup.sh BACKUP_RETENTION_DAYS default
    unverifiedAccounts: '30 days',
    guestContact: '24 months after the guest’s last booking',
    refreshSession: '30 days', // bp_rt cookie Max-Age / REFRESH_TOKEN_EXPIRE
};

const op = operatorName(COMPANY);
const mail = mailLink('privacyEmail');

// ── Shared building blocks ──────────────────────────────────────────────────

const whoWeAre = (audience) => ({
    id: 'who-we-are',
    title: 'Who we are',
    blocks: [
        `Bookplus is operated by **${op}** ("Bookplus", "we", "us"). We are responsible for (the "controller" or "responsible party" of) the personal information described in this policy. Our full details, including our registration number and addresses, are below and in our [Legal notice](/legal).`,
        { company: true },
        audience === 'business'
            ? 'This policy covers you as a business owner, and the team members you invite, when you use Bookplus for Business. Your own clients are covered by the customer version of this policy on www.bookplus.pro.'
            : 'This policy covers you when you use the Bookplus marketplace to find and book businesses, whether you have an account or book as a guest. Businesses that use Bookplus for Business have their own version of this policy on business.bookplus.pro.',
    ],
});

const businessesAsControllers = (audience) => ({
    id: 'businesses',
    title: audience === 'business' ? 'Your clients’ information' : 'The businesses you book with',
    blocks: audience === 'business'
        ? [
            'When your clients book with you, you receive their name, contact details, booking history and anything they write to you. You can also record your own notes about them, including **allergy and health notes**, and ask them to fill in intake, consent or consultation forms.',
            'For that client information **you are an independent responsible party (controller)**: you decide what you record and why, and you must handle it lawfully, keep it confidential, and delete it when you no longer need it. We store it for you and do not use it for our own purposes, except to run, secure and support the service and as the law requires. See “Your clients’ information” in the [Business Terms](/terms#your-clients).',
            'Health information is special (sensitive) personal information under POPIA, the Namibian Data Protection Bill and the GDPR. Only record what you need to provide the service safely, and tell your clients why you ask.',
        ]
        : [
            'When you book, the business you book with receives your name, contact details, the booking and anything you write to it. That business is responsible for how it uses your information in running its business, and it may keep its own records about you in its Bookplus account, such as **allergy or health notes** and your answers to its intake, consent or consultation forms.',
            'We store those records for the business and only use them to run, secure and support the service. For questions about what a business has recorded about you, contact the business first; we will help if you cannot reach it.',
        ],
});

const collectedTable = (audience) => {
    const rows = [
        ['Account details', 'Name, email address, phone number, password (stored only as a one-way hash), profile photo, and whether you are a client, business owner or team member. If you sign in with Google: your Google account ID, name, email address and profile photo.', 'You'],
        ['Sign-up choices', 'When you accepted the Terms and this policy, your confirmation that you are 16 or older, and whether you agreed to marketing emails.', 'You'],
        ['Bookings', 'The business, service, team member, date and time, price and currency, your comments and requests, reschedules, cancellations, no-shows and reminders sent. Guests also give a name, email and optional phone number.', 'You and the business'],
        ['Allergy notes and intake forms (health-related)', 'Notes a business records about you, which can include allergies, medical conditions and other health details, and your answers to a business’s intake, consent or consultation forms. **This can be health information, which the law treats as sensitive.**', 'You and the business'],
        ['Location', '“Near me”: with your permission your device’s GPS position is sent from your browser directly to OpenStreetMap to find your town. We do not receive or store your coordinates. Businesses: the business address and map pin you set.', 'Your device / the business'],
        ['Reviews', 'Your star rating and written review, shown publicly on the business’s page with your name and profile photo. Only possible after a completed booking.', 'You'],
        ['Messages', 'Messages between you and a business about a booking, and whether they have been read.', 'You and the business'],
        ['Wallet and payments', 'Prepaid wallet balances you hold with each business, top-ups, reservations, deductions, refunds and adjustments, payment references and method (bank transfer, eWallet, PayToday or cash), and gift cards (including the recipient’s name and email). We do not collect card numbers.', 'You and the business'],
        ['Photos and files', 'Profile photos, business portfolio photos, and proof-of-payment images or PDFs you upload with a top-up.', 'You'],
        ['Device and usage data', 'The pages and steps you use (for example “viewed a business”, “started a booking”), your browser type, and an analytics ID called **bp_sid** stored on your device, only if you allow analytics. Your IP address is processed by our servers for security and rate limiting. If a page crashes we receive an error report (the error, the page address without any private link or code, and your browser type).', 'Your device'],
        ['Notifications', 'If you turn on push notifications, the push address your browser gives us.', 'Your device'],
        ['Feedback', 'Answers to our short sign-up survey and suggestions you send us.', 'You'],
    ];
    if (audience === 'business') {
        rows.splice(2, 0,
            ['Business details', 'Business name, category, description, address and map pin, services, prices and currency, opening hours, cancellation policy, wallet settings, payment instructions for clients, and portfolio photos. Most of this is shown publicly on your booking page.', 'You'],
            ['Team data', 'For team members you invite: name, email, phone, role and permissions, working hours, shifts, time off, and clock-in and clock-out times.', 'You and your team'],
        );
    }
    return {
        id: 'what-we-collect',
        title: 'What we collect',
        blocks: [
            { table: { head: ['Type', 'What it includes', 'Where it comes from'], rows } },
            'We do not ask for your date of birth, ID number, card details or bank account number. Please do not put more health details in comments or forms than the business needs.',
        ],
    };
};

const purposes = () => ({
    id: 'why',
    title: 'Why we use it, and our legal basis',
    blocks: [
        'We only use personal information for the purposes below. The "legal basis" is the reason the law allows it.',
        { table: {
            head: ['Purpose', 'Information used', 'Legal basis'],
            rows: [
                ['Create and secure your account; sign you in', 'Account details, device data', 'Performing our contract with you'],
                ['Make, change and remind you of bookings; send confirmations and receipts by email; let you message the business', 'Account details, bookings, messages', 'Performing our contract with you'],
                ['Let a business keep client notes and forms it needs to serve you safely', 'Allergy notes, intake form answers', 'Your explicit consent when you give the information to the business, and the business’s own legal basis; we act for the business'],
                ['Run the prepaid wallet: top-ups, reservations, refunds, expiry reminders', 'Wallet data, proofs of payment', 'Performing our contract with you'],
                ['Find businesses near you', 'Your location (only when you tap “Near me”)', 'Your consent (your browser asks first)'],
                ['Show reviews from real bookings', 'Reviews', 'Our legitimate interest in honest reviews, and yours in reading them'],
                ['Understand how people use Bookplus so we can improve it', 'Usage data and the bp_sid analytics ID', 'Your consent, which you can withdraw at any time'],
                ['Find and fix errors; prevent fraud and abuse; keep the service secure', 'Device data, error reports, IP address', 'Our legitimate interest in a safe, working service'],
                ['Send marketing emails, such as “book again” suggestions', 'Name, email, booking history', 'Your consent (opt-in). Every marketing email has an unsubscribe link'],
                ['Keep records we must keep; respond to lawful requests; enforce our Terms', 'Any, as needed', 'Legal obligation; our legitimate interests'],
            ],
        } },
        'Where we rely on legitimate interests, we have weighed them against your rights. You can object (see "Your rights").',
    ],
});

const sharing = (audience) => ({
    id: 'sharing',
    title: 'Who we share it with',
    blocks: [
        audience === 'business'
            ? '**Your clients** see your public business page and the booking details they need. **Team members** you invite see what their permissions allow.'
            : '**The business you book with** receives the details needed for your booking, as explained above. Your reviews are public, with your name and profile photo.',
        'We use the following service providers ("processors" or "operators"). They may only use the information to provide their service to us:',
        { table: {
            head: ['Provider', 'What they do', 'Where'],
            rows: [
                ['DigitalOcean, LLC', 'Hosts our servers and database, and the database backups', 'Data centre outside Namibia (company in the USA)'],
                ['Cloudinary Ltd.', 'Stores and delivers photos and uploaded files, including proofs of payment (kept private)', 'USA'],
                ['Resend, Inc. or our mailbox provider Hostinger', 'Delivers our emails (confirmations, receipts, reminders, password resets)', 'USA (Resend); EU (Hostinger)'],
                ['Functional Software, Inc. (Sentry)', 'Error monitoring: records crash reports so we can fix them', 'USA'],
                ['Google LLC', 'Google Sign-In, if you choose it; Google Maps for the business location picker and directions links', 'USA'],
                ['OpenStreetMap Foundation (Nominatim)', 'Turns a map position into a town name for “Near me” and the business address finder. Your browser contacts it directly', 'United Kingdom'],
                ['Your browser’s push service (Google, Apple or Mozilla)', 'Delivers push notifications, only if you turn them on', 'USA / EU'],
                ['Slack or Discord', 'Short error alerts to our team', 'USA'],
            ],
        } },
        'Card payments through DPO Pay are coming soon; when they go live DPO will process card details directly and we will update this policy first.',
        'We may also disclose information when the law requires it, to protect people’s safety, or to a buyer if Bookplus is ever sold (who must keep to this policy). **We do not sell your personal information** and we do not share it for advertising.',
    ],
});

const transfers = () => ({
    id: 'transfers',
    title: 'International transfers',
    blocks: [
        'Bookplus is run from Namibia, but most of our providers store or process data in other countries, mainly the United States and the European Union. This means your information leaves Namibia (and South Africa or Europe, if you are there).',
        'We only use providers that are bound by contract to protect it, and where the law requires we rely on appropriate safeguards such as the European Commission’s standard contractual clauses or an adequacy decision (for example the EU–US Data Privacy Framework, where the provider is certified). For POPIA, transfers are made under binding agreements that give protection substantially similar to POPIA, or because they are needed to perform our contract with you. Contact us for a copy of the relevant safeguards.',
    ],
});

const retention = () => ({
    id: 'retention',
    title: 'How long we keep it',
    blocks: [
        { table: {
            head: ['Information', 'How long'],
            rows: [
                ['Your account and profile', 'Until you delete your account. Deletion removes or anonymises your personal details (see "Your rights")'],
                ['Accounts that never verified their email', `Deleted after ${RETENTION.unverifiedAccounts}`],
                ['Guest contact details (name, email, phone on a guest booking)', `Anonymised ${RETENTION.guestContact}`],
                ['Booking and wallet records', 'Kept while the business’s account is open, because the business needs them for its own accounting. When you delete your account, your name, email and phone are removed from them'],
                ['Allergy notes, client notes and form answers', 'Until the business deletes them, or you delete your account'],
                ['Messages', 'Until you delete your account'],
                ['Analytics events', RETENTION.analyticsEvents],
                ['Error logs and crash reports', RETENTION.errorLogs],
                ['Records of failed booking attempts', RETENTION.bookingRejections],
                ['Sign-in, password-reset, email-verification and invite links and tokens', 'Removed promptly once used or expired'],
                ['Database backups', `Overwritten after ${RETENTION.backups}`],
            ],
        } },
        'We may keep information longer where the law requires it, or to deal with a dispute or legal claim, and only for as long as needed.',
    ],
});

const rights = (audience) => ({
    id: 'your-rights',
    title: 'Your rights',
    blocks: [
        'Wherever you live, you can:',
        { list: [
            '**Access and export** your information. Download a copy (JSON) from your account settings, or ask us.',
            '**Correct** it. Most details can be changed in your profile; ask us for anything else.',
            '**Delete** it. Delete your account from your account settings, or ask us. We delete or anonymise your personal information, cancel your upcoming bookings and remove your uploaded photos, except records we must keep by law.',
            '**Withdraw consent** at any time, for example to analytics (cookie settings), marketing emails (unsubscribe link, or your settings) or location (your browser settings). This does not affect what we did before.',
            '**Object** to marketing (we will stop, always) and to processing based on our legitimate interests.',
            '**Restrict** processing while a complaint is looked at, where the law gives that right.',
            '**Complain** to a regulator. In South Africa: the Information Regulator (inforegulator.org.za). In the EU/UK: your local data protection authority. In Namibia the Data Protection Bill is not yet in force; you can still complain to us and we will respond.',
        ] },
        `Guests without an account can make any of these requests by writing to ${mail} from the email address used for the booking. We reply within 30 days and may ask you to prove who you are. Requests are free.`,
        audience === 'business'
            ? 'If one of your clients asks you about information you hold about them, you must deal with it. We will help you where we can.'
            : 'For records a business keeps about you, you can also ask the business directly.',
    ],
});

const cookies = () => ({
    id: 'cookies',
    title: 'Cookies and storage on your device',
    blocks: [
        'We use a few cookies and similar browser storage. We do not use advertising cookies or third-party trackers.',
        { table: {
            head: ['Name', 'Purpose', 'Type', 'Kept for'],
            rows: [
                ['bp_rt (cookie)', 'Keeps you signed in securely', 'Necessary', RETENTION.refreshSession],
                ['bp_oauth_state (cookie)', 'Protects Google sign-in against forgery', 'Necessary', '10 minutes'],
                ['token, refreshToken, user', 'Your signed-in session', 'Necessary', 'Until you sign out'],
                ['Your cookie choice', 'Remembers whether you allowed analytics', 'Necessary', 'Until you change it'],
                ['darkMode, bp_recent_providers, dismissed prompts', 'Remember your light/dark setting, businesses you viewed recently and prompts you closed', 'Preference', 'Until you clear it'],
                ['bp_sid', 'Analytics ID that links your visits so we can see where people get stuck', 'Analytics (only with your consent)', 'Until you withdraw consent or clear it'],
            ],
        } },
        'Analytics storage is only set after you allow it in the cookie banner, and you can change your choice at any time in cookie settings. Necessary storage cannot be switched off because the service does not work without it.',
        'On sign-in and sign-up pages the Google button loads Google’s logo from Google’s servers, and the business location picker loads Google Maps, which lets Google see your IP address.',
    ],
});

const children = () => ({
    id: 'children',
    title: 'Children',
    blocks: [
        'Bookplus is for people aged **16 and older**. You confirm your age when you create an account or book as a guest. We do not knowingly collect information from children under 16. If you think a child has given us information, contact us and we will delete it.',
        'A parent or guardian may book a service for their child using their own account; the parent is then the user.',
    ],
});

const security = () => ({
    id: 'security',
    title: 'Security',
    blocks: [
        'We protect your information with measures that include: encrypted connections (HTTPS with HSTS) for all traffic; passwords stored only as bcrypt hashes; short-lived sign-in tokens that are revoked when you change your password; rate limits on sign-in; access to proofs of payment only through private, time-limited links; role-based access for team members and staff; and daily backups.',
        'No system is perfectly secure. If a breach affects your information and puts you at risk, we will tell you and the relevant regulator as the law requires.',
    ],
});

const contact = () => ({
    id: 'contact',
    title: 'Contact us',
    blocks: [
        `For privacy questions or requests, write to our ${companyValue('privacyContact') ? 'Information Officer' : 'privacy contact'} at ${mail}, or by post to the address in our [Legal notice](/legal).`,
    ],
});

const changes = () => ({
    id: 'changes',
    title: 'Changes to this policy',
    blocks: [
        'When we change this policy we update the date at the top. If a change materially affects how we use your information, we tell you by email or in the app before it takes effect, and ask for your consent again where the law requires.',
    ],
});

// ── The document ────────────────────────────────────────────────────────────

export const privacyPolicy = (audience = 'customer') => {
    const sections = [
        whoWeAre(audience),
        businessesAsControllers(audience),
        collectedTable(audience),
        purposes(),
        sharing(audience),
        transfers(),
        retention(),
        rights(audience),
        cookies(),
        children(),
        security(),
        contact(),
        changes(),
    ];
    return {
        title: audience === 'business' ? 'Business Privacy Policy' : 'Privacy Policy',
        updated: PRIVACY_LAST_UPDATED,
        intro: [
            `This policy explains what personal information ${op} collects when you use Bookplus, why, who receives it, how long we keep it and your rights. It should be read with our [Terms of Service](/terms).`,
            { note: 'In short: we collect what is needed to run bookings and wallets; the business you book with sees your booking details; allergy notes and intake forms can contain health information and are shown only to that business; analytics is off until you allow it; we never sell your data; you can export or delete it at any time.' },
        ],
        sections,
    };
};
