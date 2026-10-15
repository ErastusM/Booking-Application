import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Select, useConfirm } from '@bookplus/ui';
import { analyticsService, userService } from '../../services';
import { useToast } from '../../components/Toast';
import { useAuthContext } from '../../context/AuthContext';
import DeleteUserDialog from '../../components/DeleteUserDialog';
import { userActions, roleLabel, suspendDialog, removeAdminConfirmText } from '../../utils/adminPanel';
import { PageHead, Panel, Status, Empty } from '../../components/admin/ui';
import { useAdminData } from './adminData';
import { Pager } from './Bookings';
import { count } from './format';

// Every account: clients, business owners, team logins and admins. Suspend or
// bring back, make or remove an admin, delete (with what that will do first).

const ROLE_FILTER = [
    { value: '', label: 'All roles' }, { value: 'customer', label: 'Customers' }, { value: 'provider', label: 'Business owners' },
    { value: 'staff', label: 'Team members' }, { value: 'admin', label: 'Admins' },
];
const STATUS_FILTER = [{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }];

const Users = () => {
    const toast = useToast();
    const confirm = useConfirm();
    const { user: me } = useAuthContext();
    const { refresh } = useAdminData();
    const [search, setSearch] = useState('');
    const [role, setRole] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [rows, setRows] = useState(null);
    const [meta, setMeta] = useState({ total: 0, pages: 1 });
    const [admins, setAdmins] = useState(2);
    const [busy, setBusy] = useState(null);
    const [deleting, setDeleting] = useState(null);

    // Only the latest request may fill the table (typing and paging overlap).
    const seq = useRef(0);
    const load = useCallback(async () => {
        const n = ++seq.current;
        try {
            const params = { page };
            if (search.trim()) params.search = search.trim();
            if (role) params.role = role;
            if (status) params.status = status;
            const res = await userService.getAllUsers(params);
            if (n !== seq.current) return;
            setRows(res.data.data);
            setMeta({ total: res.data.total, pages: res.data.pages || 1 });
        } catch { if (n === seq.current) { toast('Could not load users.', 'error'); setRows([]); } }
    }, [page, search, role, status, toast]);
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; load(); return undefined; }
        const t = setTimeout(load, 300); // typing in the search box
        return () => clearTimeout(t);
    }, [load]);
    const loadAdmins = useCallback(() => analyticsService.getAdminOverview().then((r) => setAdmins(r.data.data.admins)).catch(() => {}), []);
    useEffect(() => { loadAdmins(); }, [loadAdmins]);

    const patch = (id, p) => setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...p } : r)));

    const setAdmin = async (u, to) => {
        if (busy) return;
        if (to === 'admin' && !(await confirm({
            title: `Make ${u.name || 'this user'} an admin?`,
            message: `Admins can manage all users, services and platform funds, after setting up two-step sign-in. You can take admin access away later; they go back to being a ${u.role === 'provider' ? 'business owner' : 'customer'}.`,
            confirmLabel: 'Grant access',
        }))) return;
        if (u.role === 'admin' && !(await confirm({ ...removeAdminConfirmText(u), danger: true }))) return;
        setBusy(u._id);
        try {
            const updated = (await userService.updateUserRole(u._id, to)).data?.data || {};
            patch(u._id, { role: updated.role || to, roleBeforeAdmin: updated.roleBeforeAdmin ?? null });
            toast(to === 'admin' ? `${u.name} is now an admin.` : `Admin access removed. ${u.name} is a ${to === 'provider' ? 'business owner' : 'customer'} again.`, 'success');
            loadAdmins();
        } catch (err) { toast(err.response?.data?.message || 'Could not change the role.', 'error'); }
        setBusy(null);
    };

    const toggleActive = async (u) => {
        if (busy) return;
        const d = suspendDialog(u);
        const ok = await confirm({
            title: d.title,
            message: (
                <>
                    <ul style={{ margin: 0, paddingLeft: '1.15rem', display: 'grid', gap: '0.25rem', textAlign: 'left' }}>
                        {d.bullets.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                    {d.footer && <p style={{ margin: '0.7rem 0 0', textAlign: 'left' }}>{d.footer}</p>}
                </>
            ),
            confirmLabel: d.confirmLabel,
            danger: d.danger,
        });
        if (!ok) return;
        setBusy(u._id);
        try {
            const isActive = (await userService.toggleUserActive(u._id)).data.data.isActive;
            patch(u._id, { isActive });
            toast(isActive ? `${u.name} is active again.` : `${u.name} is suspended.`, 'success');
        } catch (err) { toast(err.response?.data?.message || 'Could not change the account.', 'error'); }
        setBusy(null);
    };

    const remove = async (u) => {
        setBusy(u._id);
        try {
            const res = await userService.deleteUser(u._id);
            setRows((rs) => rs.filter((r) => r._id !== u._id));
            setDeleting(null);
            const cancelled = res.data?.data?.cancelled;
            toast(u.role === 'provider'
                ? `${u.name} deleted${cancelled ? `. ${cancelled} upcoming booking${cancelled === 1 ? '' : 's'} cancelled` : ''}.`
                : `${u.name} deleted. Their name stays on their bookings.`, 'success');
            refresh();
        } catch (err) { toast(err.response?.data?.message || 'Could not delete the account.', 'error'); }
        setBusy(null);
    };

    return (
        <>
            <PageHead title="Users" />
            <div className="adm-stack">
                <div className="adm-bar">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input className="adm-input" style={{ width: '16rem', maxWidth: '100%' }} aria-label="Search users by name or email"
                            placeholder="Name, business or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                        <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} options={ROLE_FILTER} aria-label="Filter by role" size="sm" style={{ width: 'auto', minWidth: '9.5rem' }} />
                        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUS_FILTER} aria-label="Filter by status" size="sm" style={{ width: 'auto', minWidth: '8.5rem' }} />
                    </div>
                    <span className="adm-meta">{count(meta.total)} {meta.total === 1 ? 'account' : 'accounts'}</span>
                </div>
                <Panel>
                    {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No accounts found.</Empty> : (
                        <div className="adm-scroll">
                            <table className="adm-table wide">
                                <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>Status</th><th>Sign-up survey</th><th className="actions"><span className="sr-only">Actions</span></th></tr></thead>
                                <tbody>
                                    {rows.map((u) => {
                                        const act = userActions(u, me, admins);
                                        return (
                                            <tr key={u._id}>
                                                <td><span className="strong">{u.name}</span><span className="adm-sub">{u.email}</span></td>
                                                <td className="nowrap">{u.phone || <span className="dim">—</span>}</td>
                                                <td>
                                                    <span className="nowrap">{roleLabel(u)}</span>
                                                    {(act.canMakeAdmin || act.canRemoveAdmin) && (
                                                        <span className="adm-sub">
                                                            {act.canMakeAdmin && <button type="button" className="adm-link" disabled={busy === u._id} onClick={() => setAdmin(u, 'admin')}>Make admin</button>}
                                                            {act.canRemoveAdmin && (
                                                                <button type="button" className="adm-link" disabled={busy === u._id} onClick={() => setAdmin(u, act.removeAdminTo)}
                                                                    title={act.removeAdminUnrecorded ? 'No earlier role on record: they become a customer' : `They go back to being a ${act.removeAdminTo}`}>Remove admin</button>
                                                            )}
                                                        </span>
                                                    )}
                                                </td>
                                                <td>{u.isActive === false ? <Status tone="bad">Suspended</Status> : <Status tone="ok">Active</Status>}</td>
                                                <td>
                                                    {u.signupSurvey
                                                        ? <span title={u.signupSurvey.comment || ''}>{u.signupSurvey.hadDifficulty ? 'Had trouble' : 'No issues'}{u.signupSurvey.comment ? <span className="adm-sub">“{u.signupSurvey.comment}”</span> : null}</span>
                                                        : <span className="dim">—</span>}
                                                </td>
                                                <td className="actions">
                                                    {act.self ? <span className="dim">Your own account: no actions</span> : (
                                                        <>
                                                            {act.canSuspend && <button type="button" className="adm-link" disabled={busy === u._id} onClick={() => toggleActive(u)}>{u.isActive === false ? 'Activate' : 'Suspend'}</button>}
                                                            <button type="button" className="adm-link" data-tone="bad" disabled={!act.canDelete || busy === u._id} title={act.deleteBlocked || undefined}
                                                                onClick={() => act.canDelete && setDeleting(u)}>Delete</button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
                <Pager page={page} pages={meta.pages} onChange={setPage} />
            </div>
            {deleting && (
                <DeleteUserDialog user={deleting} busy={busy === deleting._id}
                    loadPreview={() => userService.getDeletePreview(deleting._id).then((r) => r.data.data)}
                    onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />
            )}
        </>
    );
};

export default Users;
