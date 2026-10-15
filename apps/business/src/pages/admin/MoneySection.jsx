import React from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import MoneyPanel from '../../components/MoneyPanel';
import { PageHead } from '../../components/admin/ui';

// The console's Money (/money/…) and Settings (/settings/…) sections: one page
// each, around the views in components/MoneyPanel.

const SECTIONS = {
    dashboard: ['Money', 'Dashboard', 'money'],
    payments: ['Money', 'Payments', 'money/payments'],
    payouts: ['Money', 'Payouts', 'money/payouts'],
    disputes: ['Money', 'Disputes', 'money/disputes'],
    approvals: ['Money', 'Approvals', 'money/approvals'],
    costs: ['Money', 'Running costs', 'money/costs'],
    prices: ['Settings', 'Prices and fees', 'settings/prices'],
    'go-live': ['Settings', 'Go-live checklist', 'settings/go-live'],
    admins: ['Settings', 'Admins and roles', 'settings/admins'],
    audit: ['Settings', 'Audit log', 'settings/audit'],
};

const MoneySection = ({ view: fixed }) => {
    const params = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const view = fixed || params.view;
    const section = SECTIONS[view];
    // /money/<a settings view> or /settings/<a money view> go to the right place.
    if (!section) return <Navigate to="/bkplus-command" replace />;
    const where = location.pathname.split('/')[2];
    if (where !== section[2].split('/')[0]) return <Navigate to={`/bkplus-command/${section[2]}`} replace />;

    const onOpen = (to, caseId = null) => navigate(`/bkplus-command/${SECTIONS[to][2]}`, caseId ? { state: { openCase: caseId } } : undefined);
    return (
        <>
            <PageHead crumb={section[0]} title={section[1]} />
            <MoneyPanel key={view} view={view} onOpen={onOpen} openCase={location.state?.openCase || null} />
        </>
    );
};

export default MoneySection;
