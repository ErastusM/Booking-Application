// Bookplus Terms of Service: the ONE source for both apps.
//   customer app -> termsOfService('customer')   (clients and guests)
//   business app -> termsOfService('business')   (business owners and their team)
// Same text format as privacy.mjs. Statements about how bookings, wallets,
// cancellations and currencies work must match the code; the rule each clause
// rests on is noted beside it. Not legal advice; have it reviewed by counsel.

import { COMPANY, operatorName, companyValue } from './company.mjs';
import { CURRENCY_CODES_TEXT } from './currencies.mjs';

export const TERMS_LAST_UPDATED = '26 September 2026';

const op = operatorName(COMPANY);
const email = COMPANY.email;
const mail = `[${email}](mailto:${email})`;
const reg = companyValue('registrationNumber');
const office = companyValue('registeredOffice');

const operatorLine = `Bookplus is operated by **${op}**${COMPANY.entityType ? `, a ${COMPANY.entityType.charAt(0).toLowerCase()}${COMPANY.entityType.slice(1)}` : ''}${reg ? ` (registration number ${reg})` : ''}${office ? `, with its registered office at ${office}` : ''}. Our full details are in our [Legal notice](/legal).`;

// ── Customer terms ─────────────────────────────────────────────────────────

const customerSections = () => [
    { id: 'about', title: 'About these Terms', blocks: [
        operatorLine,
        'These Terms apply when you use Bookplus to find and book businesses, with an account or as a guest. You accept them by ticking the box when you create an account, by continuing with Google, or by confirming a booking as a guest. Please also read our [Privacy Policy](/privacy-policy).',
    ] },
    { id: 'eligibility', title: 'Who can use Bookplus', blocks: [
        'You must be **16 or older**. If you are under 18, you confirm that a parent or guardian agrees to you using Bookplus and to these Terms.',
        'Give accurate details and keep them up to date. You are responsible for bookings made from your account.',
    ] },
    { id: 'our-role', title: 'Our role: a marketplace', blocks: [
        'Bookplus is an online **marketplace**. We provide the technology that lets you discover businesses, see their availability and prices, book, pay into a wallet and message them.',
        '**The business provides the service, not Bookplus.** Your agreement for the service is with the business. The business is responsible for the service, its quality and safety, its prices, and any licences it needs. We do not employ businesses or their staff and we do not vet, license or certify them.',
        'Reviews come only from clients who completed a booking, but they are the clients’ own opinions.',
    ] },
    { id: 'accounts', title: 'Your account', blocks: [
        { list: [
            'Keep your password private. Tell us straight away if you think someone else has used your account. Changing your password signs out your other sessions.',
            'You can close your account at any time from your account settings.',
        ] },
    ] },
    { id: 'prices', title: 'Prices, currency and payment', blocks: [
        'Each business sets its own prices and chooses the currency it prices in. Businesses on Bookplus can price in any of these currencies: ' + CURRENCY_CODES_TEXT + '. The price and currency are shown on the business page and again on the booking summary before you confirm.',
        '**Bookplus does not charge you a booking fee.** If we ever introduce a fee for clients, we will show it to you before you book.',
        'You pay the business, either at the appointment (for example cash, card or transfer, as the business accepts) or from your prepaid wallet with that business. Some businesses require wallet payment for bookings; this is shown before you confirm. Your bank may charge you for currency conversion; that is between you and your bank.',
        'The price shown is the business’s price at the time you book. If the business later changes its prices, your confirmed booking keeps the price you were shown.',
    ] },
    { id: 'bookings', title: 'Bookings and confirmations', blocks: [
        'Before you confirm, you see a summary with the business, service, date and time, duration, price and currency, how you will pay, and the business’s cancellation policy. You can go back and change anything before you confirm.',
        'Your booking is confirmed when you tap Confirm and we show it as confirmed. We email you a confirmation (with a link to manage the booking if you booked as a guest), and we email you when the booking changes.',
    ] },
    { id: 'cancellations', title: 'Cancellations, changes and no-shows', blocks: [
        { list: [
            '**Your cancellations.** Each business sets how much notice it needs, from “any time” up to several days. That notice is shown before you book. You can cancel or reschedule in the app, or from the link in your confirmation email, until the notice period starts. After that, contact the business.',
            '**If the business cancels**, we tell you by email and any wallet amount held for the booking is released back to your available balance.',
            '**No-shows.** Bookplus does not charge a no-show fee, and any wallet amount held for a booking you missed is released. A business may decide not to accept further bookings from clients who repeatedly miss appointments.',
            'Refunds for a service you are unhappy with are a matter between you and the business under its own policy and the law. We may help you contact the business, but we are not responsible for the outcome.',
        ] },
    ] },
    { id: 'wallet', title: 'The prepaid wallet', blocks: [
        'Some businesses let you keep a **prepaid balance** with them. Each wallet is with one business and can only be spent with that business.',
        { list: [
            '**Top-ups.** You pay the business directly (bank transfer, eWallet, PayToday or cash) and send a top-up request, optionally with proof of payment. The business confirms it received the money, then your balance goes up and we email you a receipt. Card top-ups through DPO Pay are coming soon.',
            '**Who holds the money.** The business receives and holds your money, not Bookplus. Bookplus keeps the record of your balance.',
            '**Reservations.** When you book with wallet payment, the price is held from your balance. It is taken when the service is completed, and released if the booking is cancelled or missed.',
            '**Refunds.** Each business decides whether it refunds unused balances. **Some businesses make balances non-refundable.** The business’s rule is shown before you top up and on your wallet, and you must confirm that you understand it. Where a refund is allowed, ask the business; a refund is added only after you approve it.',
            '**Expiry.** A business may set its balances to **expire after 6, 12 or 24 months without any wallet activity** (a top-up, booking, payment or refund). If it does, you see this before you top up, your wallet shows the date your balance will expire, and we email and notify you **30 days and 7 days before**. Using or topping up the wallet restarts the period. Money held for an upcoming booking does not expire. When a balance expires it is removed from your wallet.',
            '**Adjustments.** A business can propose a correction to your balance; it only applies if you approve it.',
            '**Gift cards** add a balance to your wallet with the business that sold them and follow that business’s rules.',
        ] },
        'Nothing in these rules takes away a refund you are entitled to by law.',
    ] },
    { id: 'reviews', title: 'Reviews', blocks: [
        'You can review a business once for each completed booking. Reviews must be honest and about your own experience. Do not post reviews that are false, offensive, discriminatory, that include other people’s personal information, or that you were paid or rewarded for. Businesses must not write, buy or reward reviews of themselves.',
        'We may remove reviews that break these rules or the law. We do not edit reviews, and we do not remove a review just because it is negative.',
    ] },
    { id: 'acceptable-use', title: 'Acceptable use', blocks: [
        { list: [
            'Do not use Bookplus for anything unlawful, fraudulent, harmful or misleading, or to harass anyone.',
            'Do not make fake bookings, book slots you do not intend to keep, or send false proof of payment.',
            'Do not misuse, disrupt, scrape, reverse-engineer or try to gain unauthorised access to the platform or other people’s accounts.',
            'Do not upload content that is unlawful, infringing or offensive, or that you have no right to share.',
        ] },
    ] },
    { id: 'content', title: 'Your content and our intellectual property', blocks: [
        'Content you upload (photos, reviews, messages) stays yours. You give us a non-exclusive licence to host, show and process it to run Bookplus, for as long as it is on the platform. The Bookplus name, logo and software belong to us.',
    ] },
    { id: 'liability', title: 'Liability', blocks: [
        'We work to keep Bookplus available and accurate, but it is provided “as is”, and business listings, prices and availability are supplied by the businesses.',
        { list: [
            'We are not liable for the services a business provides, or for what a business or another user does or fails to do.',
            'We are not liable for indirect or consequential loss, or for loss of profit, data or opportunity.',
            'Our total liability to you for any claim about Bookplus is limited to direct loss, up to the greater of what you paid Bookplus in the 12 months before the claim or N$1,000.',
        ] },
        'Nothing in these Terms limits liability for fraud, for death or injury caused by our negligence, or any other liability or consumer right that the law does not allow to be limited.',
    ] },
    { id: 'termination', title: 'Suspending or closing accounts', blocks: [
        'You can close your account at any time. We may suspend or close an account, or remove content, if it breaks these Terms, puts other users at risk, or where the law requires. Where we reasonably can, we tell you why first and give you a chance to respond. If your account is closed, contact the businesses you hold wallet balances with about those balances.',
    ] },
    { id: 'disputes', title: 'Complaints and disputes', blocks: [
        '**With a business:** contact the business first, using the booking messages or its contact details. If that does not work, tell us at ' + mail + ' and we will try to help both sides reach a fair outcome, but the decision rests with the business and you.',
        '**With us:** email ' + mail + '. We aim to reply within 5 working days and to resolve complaints within 30 days. If we cannot agree, either of us may go to the courts named below.',
    ] },
    { id: 'law', title: 'Governing law', blocks: [
        `These Terms are between you and **${op}** and are governed by the laws of the **Republic of Namibia**. The courts of Namibia have jurisdiction. If you live outside Namibia, you keep any consumer rights, and any right to go to your local courts, that the law of your country gives you and that cannot be excluded.`,
        'You agree that these Terms, your booking confirmations and other notices can be made and kept electronically, in line with the Electronic Transactions Act 4 of 2019. You can save or print these Terms from this page at any time.',
    ] },
    { id: 'changes', title: 'Changes to these Terms', blocks: [
        'We may update these Terms, for example when we add features or the law changes. The date at the top shows the latest version. If a change is significant we tell you in advance by email or in the app. Bookings you already made stay under the Terms that applied when you made them.',
    ] },
    { id: 'contact', title: 'Contact', blocks: [
        `${op}: ${mail}${companyValue('phone') ? `, ${companyValue('phone')}` : ''}. Full details are in our [Legal notice](/legal).`,
    ] },
];

// ── Business terms ─────────────────────────────────────────────────────────

const businessSections = () => [
    { id: 'about', title: 'About these Terms', blocks: [
        operatorLine,
        'These Terms apply when you use Bookplus for Business to take bookings, manage your calendar, team and clients, and be listed on the Bookplus marketplace. You accept them by ticking the box when you register, by continuing with Google, or, for team members, by accepting an invitation. Please also read our [Privacy Policy](/privacy-policy).',
    ] },
    { id: 'eligibility', title: 'Eligibility and your account', blocks: [
        { list: [
            'You must be at least 18 and authorised to bind your business.',
            'Give accurate business and contact details and keep them up to date. Keep your login details private; you are responsible for activity under your account. Changing your password signs out your other sessions.',
        ] },
    ] },
    { id: 'our-role', title: 'Our role: a marketplace', blocks: [
        'Bookplus is a booking **marketplace and software provider**. We are **not** the provider of your services, **not** a party to your agreement with your clients, and we do **not** employ you or your staff. We do not vet, license or certify businesses, and we do not describe any business as verified or endorsed.',
    ] },
    { id: 'listings', title: 'Your listings, prices and policies', blocks: [
        { list: [
            'You are responsible for your listing, prices, availability and the quality, safety and legality of your services, and for holding any licences or qualifications you need.',
            'You choose the currency you price in from the currencies Bookplus supports (' + CURRENCY_CODES_TEXT + '). Prices are shown to clients in that currency. Show the full price; do not add charges at the appointment that were not shown when the client booked, unless the client asks for extra services.',
            'You set your cancellation notice. It is shown to clients before they book and applied by the platform. Honour confirmed bookings.',
            'You are responsible for your own taxes, including any VAT on your services.',
        ] },
    ] },
    { id: 'wallet', title: 'Client wallets', blocks: [
        'If you turn on the wallet, your clients can prepay a balance that can only be spent with you.',
        { list: [
            'Clients pay you directly. **You receive and hold the money**, and you must confirm a top-up only once the money has arrived.',
            'You choose whether unused balances are **refundable**, and whether balances **expire after 6, 12 or 24 months without activity**. Bookplus shows your rules to clients before they top up and on their wallet, clients must confirm they understand them, and we remind clients 30 and 7 days before a balance expires.',
            'Keep to the rules you show. Before you turn refunds off or introduce or shorten an expiry period, tell your existing wallet clients; do not use a stricter new rule to refuse a refund or remove a balance that was topped up under an earlier, more generous rule, unless the client agrees.',
            'Refunds and adjustments you propose only apply once the client approves them.',
            'You remain responsible to your clients for their balances, including if you close your account. Settle or refund outstanding balances before you close it.',
        ] },
    ] },
    { id: 'team', title: 'Your team', blocks: [
        'You may invite staff with the permissions you choose. You are responsible for who you give access to, what they do in your account, and removing access when they leave. Team members must accept these Terms when they accept an invitation.',
    ] },
    { id: 'your-clients', title: 'Your clients’ information', blocks: [
        'For your clients’ personal information that you collect or access through Bookplus (contact details, booking history, messages, and any **client notes, allergy or health notes and intake or consent form answers**), **you are an independent responsible party (controller)**. You must:',
        { list: [
            'collect only what you need for your services, and tell clients why;',
            'get a client’s explicit consent before recording health information, and keep it confidential;',
            'use client information only to provide and manage your services, and never for unrelated marketing without consent;',
            'answer clients’ requests to see, correct or delete their information; and',
            'comply with the data protection law that applies to you, including POPIA if you operate in South Africa.',
        ] },
        'We store this information for you and only use it to run, secure and support Bookplus, or as the law requires. Our [Privacy Policy](/privacy-policy) explains what we do as the platform operator.',
    ] },
    { id: 'fees', title: 'Fees', blocks: [
        'We will tell you about any subscription, commission or other fee, and its amount, before it applies to you. You can close your account if you do not accept a new fee.',
    ] },
    { id: 'reviews', title: 'Reviews', blocks: [
        'Only clients who completed a booking with you can review you, once per booking. Do not write, buy or reward reviews, or pressure clients about their reviews. You may report a review that breaks our rules; we do not remove reviews just because they are negative.',
    ] },
    { id: 'acceptable-use', title: 'Acceptable use', blocks: [
        { list: [
            'Do not use Bookplus for anything unlawful, fraudulent, harmful or misleading.',
            'Do not make claims about your business that you cannot back up, or describe yourself as vetted, verified or endorsed by Bookplus.',
            'Do not misuse, disrupt, scrape or try to gain unauthorised access to the platform.',
            'Do not upload content that is unlawful, infringing or offensive, or that you have no right to use.',
        ] },
    ] },
    { id: 'content', title: 'Content and intellectual property', blocks: [
        'Content you upload stays yours. You give us a non-exclusive licence to host, show and process it to run Bookplus and to show your listing on the marketplace. The Bookplus name, logo and software belong to us.',
    ] },
    { id: 'liability', title: 'Liability and indemnity', blocks: [
        'Bookplus is provided “as is”. We are not liable for your services, for the acts of your clients or staff, or for indirect or consequential loss, including lost bookings, revenue or data. Our total liability to you is limited to direct loss, up to the greater of the fees you paid Bookplus in the 12 months before the claim or N$1,000. Nothing limits liability that the law does not allow to be limited.',
        'You agree to compensate Bookplus for claims and losses caused by your services, your breach of these Terms, or your handling of your clients’ information or wallet balances.',
    ] },
    { id: 'termination', title: 'Suspending or closing accounts', blocks: [
        'You can close your business account at any time, after honouring or properly cancelling confirmed bookings and settling client wallet balances. We may suspend or close accounts that break these Terms or put others at risk; where we reasonably can, we tell you why first.',
    ] },
    { id: 'disputes', title: 'Disputes', blocks: [
        'Disputes with your clients are between you and them. If you have a complaint about Bookplus, email ' + mail + '; we aim to resolve it within 30 days.',
    ] },
    { id: 'law', title: 'Governing law', blocks: [
        `These Terms are between you and **${op}** and are governed by the laws of the **Republic of Namibia**. The courts of Namibia have jurisdiction over any dispute.`,
        'These Terms and other notices may be made and kept electronically, in line with the Electronic Transactions Act 4 of 2019.',
    ] },
    { id: 'changes', title: 'Changes and contact', blocks: [
        `We may update these Terms; the date at the top shows the latest version, and we tell you in advance about significant changes. Contact: ${mail}${companyValue('phone') ? `, ${companyValue('phone')}` : ''}. Full details are in our [Legal notice](/legal).`,
    ] },
];

export const termsOfService = (audience = 'customer') => ({
    title: audience === 'business' ? 'Business Terms of Service' : 'Terms of Service',
    updated: TERMS_LAST_UPDATED,
    intro: [],
    sections: audience === 'business' ? businessSections() : customerSections(),
});
