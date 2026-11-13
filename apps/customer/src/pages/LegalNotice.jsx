import React from 'react';
import { legalNotice } from '@bookplus/config/legal/notice.mjs';
import LegalPage from '../legal/LegalPage';
import { FEATURES } from '@bookplus/config/features.mjs';

// "Who we are": the operator's identity and contact details (company.mjs).
const doc = legalNotice('customer', FEATURES);

const LegalNotice = () => (
    <LegalPage doc={doc} path="/legal" description="Who operates Bookplus: company name, registration number, addresses and contact details." />
);

export default LegalNotice;
