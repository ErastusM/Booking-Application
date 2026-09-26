/**
 * The Terms of Service name every currency a business can price in (compliance
 * scorecard point 4: the Terms used to say "Namibian Dollars only"). The list
 * the Terms render lives in packages/config/legal/currencies.mjs; this keeps it
 * identical to the API's own list, so adding a currency without updating the
 * Terms fails CI.
 */
const fs = require('fs');
const path = require('path');
const { CURRENCY_CODES } = require('../../constants/currencies');

describe('Terms currency list', () => {
    it('matches the currencies the API accepts', () => {
        const file = path.resolve(__dirname, '../../../../../packages/config/legal/currencies.mjs');
        const src = fs.readFileSync(file, 'utf8');
        const codes = [...src.matchAll(/\['([A-Z]{3})',/g)].map((m) => m[1]);
        expect(codes.sort()).toEqual([...CURRENCY_CODES].sort());
    });
});
