import React from 'react';
import { legalNotice } from '@bookplus/config/legal/notice.mjs';
import LegalPage from '../legal/LegalPage';
import { FEATURES } from '@bookplus/config/features.mjs';

// "Who we are": the operator's identity and contact details (company.mjs).
const doc = legalNotice('business', FEATURES);

const LegalNotice = () => <LegalPage doc={doc} path="/legal" />;

export default LegalNotice;
