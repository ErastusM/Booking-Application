import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { financeService, providerWalletService } from '../../services';
import { useAuthContext } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import '../../styles/admin.css';
import Overview from './Overview';
import Bookings from './Bookings';
import Users from './Users';
import Services from './Services';
import Revenue from './Revenue';
import Wallets from './Wallets';
import Insights from './Insights';
import MoneySection from './MoneySection';
import { AdminData } from './adminData';

/**
 * The admin console (/bkplus-command/*): a sidebar of sections (a drawer on a
 * phone) and one page at a time. It sits behind two-step sign-in
 * (components/AdminTwoStep) like every admin request on the API.
 *
 * The sidebar counts what needs someone: payments to look at, payouts due,
 * applications and refunds waiting, open cases, wallet top-ups. They refresh
 * every minute and when you move between sections.
 */


const settle = async (p) => { try { return await p; } catch { return null; } };

const loadCounts = async () => {
    const [attention, due, applications, requests, cases, settings, wallets] = await Promise.all([
        settle(financeService.payments({ view: 'attention', limit: 1 })),
        settle(financeService.payoutsDue()),
        settle(financeService.listApprovals('waiting')),
        settle(financeService.listRequests('pending')),
        settle(financeService.disputes('open')),
        settle(financeService.getSettings()),
        settle(providerWalletService.getAdminSummary()),
    ]);
    const payable = due ? due.data.data.filter((r) => r.payable) : null;
    return {
        money: !!settings, // false: no money role (or not set up), so the Money rows stay out
        payments: attention ? attention.data.total ?? attention.data.data?.length ?? 0 : null,
        payouts: payable ? payable.length : null,
        payoutsCents: payable ? due.data.totalPayableCents : null,
        payoutSchedule: due ? due.data.schedule : null,
        applications: applications ? applications.data.data.length : null,
        oldestApplication: applications?.data.data.reduce((o, r) => (r.submittedAt && (!o || r.submittedAt < o) ? r.submittedAt : o), null) || null,
        requests: requests ? requests.data.data.length : null,
        cases: cases ? cases.data.data.length : null,
        launch: settings ? settings.data.data.launch : null,
        roles: settings ? settings.data.data.me?.roles || [] : [],
        topUps: wallets ? wallets.data.data?.pendingTopUps ?? 0 : null,
    };
};

const NAV = [
    { group: null, items: [
        ['', 'Overview'], ['bookings', 'Bookings'], ['users', 'Users'], ['services', 'Services'],
        ['revenue', 'Revenue'], ['wallets', 'Wallets', (c) => ({ n: c?.topUps, hot: true })], ['insights', 'Insights'],
    ] },
    { group: 'Money', money: true, items: [
        ['money', 'Dashboard'],
        ['money/payments', 'Payments', (c) => ({ n: c?.payments, hot: true })],
        ['money/payouts', 'Payouts', (c) => ({ n: c?.payouts })],
        ['money/disputes', 'Disputes', (c) => ({ n: c?.cases })],
        ['money/approvals', 'Approvals', (c) => ({ n: (c?.applications ?? 0) + (c?.requests ?? 0), hot: true })],
        ['money/costs', 'Costs'],
    ] },
    { group: 'Settings', money: true, items: [
        ['settings/prices', 'Prices and fees'], ['settings/go-live', 'Go-live checklist'],
        ['settings/admins', 'Admins and roles'], ['settings/audit', 'Audit log'],
    ] },
];

const roleText = (roles) => {
    if (roles.includes('director')) return roles.includes('finance') ? 'Director and finance' : 'Director';
    return roles.includes('finance') ? 'Finance' : 'Admin';
};

const Sidebar = ({ counts, onNavigate, id }) => {
    const { user, logout } = useAuthContext();
    const { darkMode, toggleDarkMode } = useTheme();
    const navigate = useNavigate();
    const signOut = async () => { await logout(); navigate('/bkplus-command/login', { replace: true }); };
    const showMoney = counts?.money !== false;
    return (
        <aside className="adm-side" id={id}>
            <NavLink to="/bkplus-command" end className="adm-brand" onClick={onNavigate}><b>Book<span>plus</span></b><small>Admin</small></NavLink>
            <nav aria-label="Admin" className="adm-nav">
                {NAV.filter((g) => !g.money || showMoney).map((g) => (
                    <React.Fragment key={g.group || 'main'}>
                        {g.group && <div className="adm-group" aria-hidden="true">{g.group}</div>}
                        {g.items.map(([path, text, count]) => {
                            const c = count ? count(counts) : null;
                            return (
                                <NavLink key={path} to={`/bkplus-command${path ? `/${path}` : ''}`} end={path === '' || path === 'money'} onClick={onNavigate}>
                                    <span>{text}</span>
                                    {c && c.n > 0 && <span className="adm-count" data-hot={String(!!c.hot)} aria-label={`${c.n} waiting`}>{c.n}</span>}
                                </NavLink>
                            );
                        })}
                    </React.Fragment>
                ))}
            </nav>
            <div className="adm-foot">
                <div><b>{user?.name || 'Admin'}</b>{roleText(counts?.roles || [])}</div>
                <div className="adm-foot-actions">
                    <button type="button" onClick={toggleDarkMode}>{darkMode ? 'Light mode' : 'Dark mode'}</button>
                    <button type="button" onClick={signOut}>Sign out</button>
                </div>
            </div>
        </aside>
    );
};

const AdminConsole = () => {
    const location = useLocation();
    const [counts, setCounts] = useState(null);
    const [drawer, setDrawer] = useState(false);
    const burger = useRef(null);
    const last = useRef(0);

    const refresh = useCallback(async () => {
        last.current = Date.now();
        setCounts(await loadCounts());
    }, []);
    useEffect(() => {
        refresh();
        const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
        return () => clearInterval(t);
    }, [refresh]);
    // Moving between sections refreshes the counts (at most every 15 s).
    useEffect(() => {
        setDrawer(false);
        if (Date.now() - last.current > 15000) refresh();
    }, [location.pathname, refresh]);

    // The phone drawer: Escape closes it, the page behind doesn't scroll.
    useEffect(() => {
        if (!drawer) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { setDrawer(false); burger.current?.focus(); } };
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        document.querySelector('#adm-drawer a')?.focus();
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    }, [drawer]);

    return (
        <AdminData.Provider value={{ counts, refresh }}>
            <div className="adm" data-drawer={drawer ? 'open' : 'closed'} data-testid="admin-console">
                <Sidebar counts={counts} id="adm-drawer" onNavigate={() => setDrawer(false)} />
                <div className="adm-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                    <div className="adm-topbar">
                        <button ref={burger} type="button" className="adm-burger" aria-label={drawer ? 'Close menu' : 'Open menu'}
                            aria-expanded={drawer} aria-controls="adm-drawer" onClick={() => setDrawer((d) => !d)}>
                            {drawer ? <X size={18} /> : <Menu size={18} />}
                        </button>
                        <NavLink to="/bkplus-command" className="adm-brand"><b>Book<span>plus</span></b><small>Admin</small></NavLink>
                    </div>
                    <div className="adm-main">
                        <Routes>
                            <Route index element={<Overview />} />
                            <Route path="bookings" element={<Bookings />} />
                            <Route path="users" element={<Users />} />
                            <Route path="services" element={<Services />} />
                            <Route path="revenue" element={<Revenue />} />
                            <Route path="wallets" element={<Wallets />} />
                            <Route path="insights" element={<Insights />} />
                            <Route path="money" element={<MoneySection view="dashboard" />} />
                            <Route path="money/:view" element={<MoneySection />} />
                            <Route path="settings/:view" element={<MoneySection />} />
                            <Route path="*" element={<Navigate to="/bkplus-command" replace />} />
                        </Routes>
                    </div>
                </div>
            </div>
        </AdminData.Provider>
    );
};

export default AdminConsole;
