import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { financeService, providerWalletService } from '../../services';
import { useAuthContext } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useTwoStepStatus } from '../../components/AdminTwoStep';
import NotificationBell from '../../components/NotificationBell';
import { lockScroll, unlockScroll, trapTab } from '../../hooks/useModalChrome';
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
 * every minute and when you move between sections. A count that fails to load
 * keeps its last value; only the API saying "no money role" hides the Money
 * and Settings sections.
 */

const settle = async (p) => { try { return { value: await p }; } catch (error) { return { error }; } };

export const loadCounts = async (prev = null) => {
    const [attention, due, applications, requests, cases, settings, wallets] = await Promise.all([
        settle(financeService.payments({ view: 'attention', limit: 1 })),
        settle(financeService.payoutsDue()),
        settle(financeService.listApprovals('waiting')),
        settle(financeService.listRequests('pending')),
        settle(financeService.disputes('open')),
        settle(financeService.getSettings()),
        settle(providerWalletService.getAdminSummary()),
    ]);
    const noRole = settings.error?.response?.data?.code === 'finance_role_required';
    // A value from this round, else the last good one (a failed poll changes nothing).
    const keep = (r, pick, key) => (r.value ? pick(r.value.data) : (prev?.[key] ?? null));
    const payable = due.value ? due.value.data.data.filter((r) => r.payable) : null;
    return {
        // true: money role; false: the API said there is none; otherwise the last known.
        money: settings.value ? true : noRole ? false : (prev?.money ?? undefined),
        error: !settings.value && !noRole, // the money counts could not be loaded this round
        payments: keep(attention, (d) => d.total ?? d.data?.length ?? 0, 'payments'),
        payouts: payable ? payable.length : (prev?.payouts ?? null),
        payoutsCents: due.value ? due.value.data.totalPayableCents : (prev?.payoutsCents ?? null),
        payoutSchedule: due.value ? due.value.data.schedule : (prev?.payoutSchedule ?? null),
        applications: keep(applications, (d) => d.data.length, 'applications'),
        oldestApplication: applications.value
            ? applications.value.data.data.reduce((o, r) => (r.submittedAt && (!o || r.submittedAt < o) ? r.submittedAt : o), null)
            : (prev?.oldestApplication ?? null),
        requests: keep(requests, (d) => d.data.length, 'requests'),
        cases: keep(cases, (d) => d.data.length, 'cases'),
        launch: keep(settings, (d) => d.data.launch, 'launch'),
        roles: settings.value ? settings.value.data.data.me?.roles || [] : (prev?.roles ?? []),
        topUps: keep(wallets, (d) => d.data?.pendingTopUps ?? 0, 'topUps'),
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

const Brand = ({ onClick }) => (
    <Link to="/bkplus-command" className="adm-brand" onClick={onClick}><b>Book<span>plus</span></b><small>Admin</small></Link>
);

const Sidebar = ({ counts, onNavigate, onClose, asideRef, open }) => {
    const { user, logout } = useAuthContext();
    const { darkMode, toggleDarkMode } = useTheme();
    const twoStep = useTwoStepStatus();
    const navigate = useNavigate();
    const signOut = async () => { await logout(); navigate('/bkplus-command/login', { replace: true }); };
    const showMoney = counts?.money !== false;
    const codesLeft = twoStep?.recoveryCodesLeft;
    return (
        <aside className="adm-side" id="adm-drawer" ref={asideRef} onKeyDown={(e) => { if (open) trapTab(e, asideRef.current); }}>
            <div className="adm-side-top">
                <Brand onClick={onNavigate} />
                <button type="button" className="adm-close" aria-label="Close menu" onClick={onClose}><X size={18} /></button>
            </div>
            <nav aria-label="Admin" className="adm-nav">
                {NAV.filter((g) => !g.money || showMoney).map((g) => {
                    const links = g.items.map(([path, text, count]) => {
                        const c = count ? count(counts) : null;
                        return (
                            <NavLink key={path} to={`/bkplus-command${path ? `/${path}` : ''}`} end={path === '' || path === 'money'} onClick={onNavigate}>
                                <span>{text}</span>
                                {c && c.n > 0 && <span className="adm-count" data-hot={String(!!c.hot)} aria-label={`${c.n} waiting`}>{c.n}</span>}
                            </NavLink>
                        );
                    });
                    if (!g.group) return <React.Fragment key="main">{links}</React.Fragment>;
                    const id = `adm-group-${g.group.toLowerCase()}`;
                    return (
                        <div key={g.group} role="group" aria-labelledby={id} className="adm-nav">
                            <div className="adm-group" id={id}>{g.group}</div>
                            {links}
                        </div>
                    );
                })}
            </nav>
            <div className="adm-foot">
                <div><b>{user?.name || 'Admin'}</b>{roleText(counts?.roles || [])}</div>
                {codesLeft !== undefined && codesLeft <= 2 && (
                    <div className="adm-foot-warn" role="status">
                        {codesLeft === 0 ? 'No recovery codes left' : `${codesLeft} recovery code${codesLeft === 1 ? '' : 's'} left`}
                    </div>
                )}
                <div className="adm-foot-actions">
                    <button type="button" onClick={toggleDarkMode}>{darkMode ? 'Light mode' : 'Dark mode'}</button>
                    <button type="button" onClick={signOut}>Sign out</button>
                </div>
            </div>
        </aside>
    );
};

const PHONE = '(max-width: 1023px)';

const AdminConsole = () => {
    const location = useLocation();
    const [counts, setCounts] = useState(null);
    const [drawer, setDrawer] = useState(false);
    const burger = useRef(null);
    const aside = useRef(null);
    const last = useRef(0);
    const countsRef = useRef(null);

    const refresh = useCallback(async () => {
        last.current = Date.now();
        const next = await loadCounts(countsRef.current);
        countsRef.current = next;
        setCounts(next);
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

    // The phone drawer: the page behind is locked and inert, Tab stays in the
    // drawer, Escape closes it, and focus goes back to the menu button.
    useEffect(() => {
        if (!drawer) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
        document.addEventListener('keydown', onKey);
        lockScroll();
        aside.current?.querySelector('a, button')?.focus();
        const wide = window.matchMedia ? window.matchMedia(PHONE) : null;
        const onWide = () => { if (wide && !wide.matches) setDrawer(false); };
        wide?.addEventListener?.('change', onWide);
        return () => {
            document.removeEventListener('keydown', onKey);
            wide?.removeEventListener?.('change', onWide);
            unlockScroll();
            const at = document.activeElement;
            if (!at || at === document.body || aside.current?.contains(at)) burger.current?.focus();
        };
    }, [drawer]);

    return (
        <AdminData.Provider value={{ counts, refresh }}>
            <div className="adm" data-drawer={drawer ? 'open' : 'closed'} data-testid="admin-console">
                <Sidebar counts={counts} asideRef={aside} open={drawer} onNavigate={() => setDrawer(false)} onClose={() => setDrawer(false)} />
                <div className="adm-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
                <div className="adm-content" {...(drawer ? { inert: '' } : {})}>
                    <div className="adm-topbar">
                        <button ref={burger} type="button" className="adm-burger" aria-label="Open menu"
                            aria-expanded={drawer} aria-controls="adm-drawer" onClick={() => setDrawer(true)}>
                            <Menu size={18} />
                        </button>
                        <Brand />
                    </div>
                    <div className="adm-bell"><NotificationBell tone="dark" /></div>
                    <div className="adm-main" id="admin-content" tabIndex={-1}>
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
