import React from 'react';
import { legalNotice } from '@bookplus/config/legal/notice.mjs';
import LegalPage from '../legal/LegalPage';
import { LEGAL_FEATURES } from '../utils/onlinePayment';

// "Who we are": the operator's identity and contact details (company.mjs).
const doc = legalNotice('business', LEGAL_FEATURES);

const LegalNotice = () => <LegalPage doc={doc} path="/legal" />;

export default LegalNotice;
