/**
 * What is kept of a PayGate notify (subscriptionBilling.sanitizeNotify): known
 * fields only, anything card-like masked, but our own reference and PayGate's
 * request id kept exactly, even when they contain a long run of digits.
 */
const { sanitizeNotify } = require('../../services/subscriptionBilling');

describe('sanitizeNotify', () => {
    it('keeps the payment reference whole even when it has a long run of digits', () => {
        const reference = 'BS46393327722225C01AF17E81C087BC'; // a reference CI drew at random
        const payRequestId = '23B785AE-C96C-32AF-4879-123456789012';
        const out = sanitizeNotify([['REFERENCE', reference], ['PAY_REQUEST_ID', payRequestId], ['TRANSACTION_STATUS', '1']]);
        expect(out).toEqual({ REFERENCE: reference, PAY_REQUEST_ID: payRequestId, TRANSACTION_STATUS: '1' });
    });

    it('still masks card-like numbers elsewhere, and in a value that is not one of our references', () => {
        const out = sanitizeNotify([
            ['RESULT_DESC', 'Card 4000000000000002 declined'],
            ['REFERENCE', 'not-ours-4000000000000002'],
            ['PAY_METHOD_DETAIL', 'Visa 4000000000000002'],
        ]);
        expect(out.RESULT_DESC).toBe('Card ****0002 declined');
        expect(out.REFERENCE).toBe('not-ours-****0002');
        expect(out.PAY_METHOD_DETAIL).toBe('Visa ****0002');
    });

    it('drops unknown and sensitive fields', () => {
        const out = sanitizeNotify([['CHECKSUM', 'abc'], ['VAULT_ID', 'x'], ['RISK_INDICATOR', 'AX'], ['AMOUNT', '7999']]);
        expect(out).toEqual({ AMOUNT: '7999' });
    });
});
