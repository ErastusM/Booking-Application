import React from 'react';
import { Link } from 'react-router-dom';

// A business's prepaid-wallet rules in plain words: whether it refunds unused
// balances, and whether (and when) balances expire. Shown in the top-up modal
// BEFORE the client pays, and on each wallet card. The wording mirrors the
// server's sweep (walletExpiryService): a balance expires after N months with no
// wallet activity, never while funds are reserved for a booking.

// Ticking "I understand" is required when the client could lose money.
export const walletRulesNeedAck = (rules) => !!rules && (rules.refundsAllowed === false || Number(rules.expiryMonths) > 0);

export const formatExpiryDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const WalletRules = ({ rules, providerName, compact = false }) => {
    if (!rules) return null;
    const months = Number(rules.expiryMonths) || 0;
    const item = { margin: '0 0 0.3rem', fontSize: compact ? '0.78rem' : '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 };
    return (
        <ul style={{ margin: 0, padding: '0 0 0 1.1rem' }}>
            <li style={item}>
                {rules.refundsAllowed === false
                    ? <><strong style={{ color: 'var(--charcoal)' }}>Non-refundable.</strong> {providerName} does not refund unused wallet balances. You can spend them on bookings with {providerName}.</>
                    : <><strong style={{ color: 'var(--charcoal)' }}>Refundable.</strong> You can ask {providerName} to refund an unused balance.</>}
            </li>
            <li style={item}>
                {months > 0
                    ? <><strong style={{ color: 'var(--charcoal)' }}>Expires after {months} months without activity.</strong> If you don’t use or top up this wallet for {months} months, the unused balance is removed. Funds held for an upcoming booking never expire. We remind you by email 30 and 7 days before.</>
                    : <><strong style={{ color: 'var(--charcoal)' }}>No expiry.</strong> Your balance with {providerName} does not expire.</>}
            </li>
            {!compact && (
                <li style={item}>
                    The balance is held by {providerName}, not by Bookplus. See the <Link to="/terms#wallet" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-dark)' }}>wallet terms</Link>.
                </li>
            )}
        </ul>
    );
};

export default WalletRules;
