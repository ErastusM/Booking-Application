import React from 'react';
import { legalNotice } from '@bookplus/config/legal/notice.mjs';
import LegalPage from '../legal/LegalPage';

// "Who we are": the operator's identity and contact details (company.mjs).
const doc = legalNotice('business');

const LegalNotice = () => <LegalPage doc={doc} path="/legal" />;

export default LegalNotice;
