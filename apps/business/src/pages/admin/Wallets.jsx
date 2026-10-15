import React, { useCallback, useEffect, useState } from 'react';
import { FEATURES } from '@bookplus/config/features.mjs';
import { providerWalletService, userService, walletService } from '../../services';
import { useToast } from '../../components/Toast';
import ProofLink from '../../components/ProofLink';
import WalletAdjustDialog from '../../components/WalletAdjustDialog';
import { businessName, walletToast } from '../../utils/adminPanel';
import { PageHead, Panel, Kpis, Status, Empty } from '../../components/admin/ui';
import { useAdminData } from './adminData';
import { count, money } from './format';

// Business accounts with Bookplus (prepaid balances): top-ups to approve, each
// business's balance, and a manual credit or debit with a reason. The client
// wallet is shown read-only while it is switched off.

const shortDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const RESOLVED = { approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'] };

const TopUpRow = ({ t, who, proof, canDecide, busy, onDecide }) => (
    <div className="adm-row">
        <div>
            <span className="strong">{who}</span> · {money(t.amount)}
            <span className="adm-sub">
                {shortDate(t.createdAt)}{t.reference ? ` · ${t.reference}` : ''}
                {' · '}{t.method === 'cash' ? 'Cash, no proof needed' : proof}
            </span>
        </div>
        {t.status === 'pending' && canDecide ? (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => onDecide(true)}>{busy ? '…' : 'Approve'}</button>
                <button type="button" className="btn-outline" disabled={busy} onClick={() => onDecide(false)}>Reject</button>
            </div>
        ) : (
            <Status tone={(RESOLVED[t.status] || [null, 'warn'])[1]}>{(RESOLVED[t.status] || ['Pending'])[0]}</Status>
        )}
    </div>
);

const Wallets = () => {
    const toast = useToast();
    const { refresh } = useAdminData();
    const [summary, setSummary] = useState(null);
    const [topUps, setTopUps] = useState(null);
    const [wallets, setWallets] = useState([]);
    const [clientTopUps, setClientTopUps] = useState([]);
    const [adjust, setAdjust] = useState(null); // null closed; {} pick a business; { provider }
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        try {
            const [s, t, w, ct] = await Promise.all([
                providerWalletService.getAdminSummary(), providerWalletService.getTopUps(),
                providerWalletService.getAllWallets(), walletService.adminGetClientTopUps(),
            ]);
            setSummary(s.data.data); setTopUps(t.data.data || []); setWallets(w.data.data || []); setClientTopUps(ct.data.data || []);
        } catch { toast('Could not load the wallets.', 'error'); setTopUps((x) => x || []); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const decideBusiness = async (t, approve) => {
        if (busy) return;
        setBusy(t._id);
        try {
            const res = approve ? await providerWalletService.approveTopUp(t._id) : await providerWalletService.rejectTopUp(t._id);
            const txn = res.data?.data || {};
            toast(walletToast(approve ? 'approve' : 'reject', txn.amount ?? t.amount, businessName(t.provider), txn.balanceAfter), 'success');
            await load();
            refresh();
        } catch (err) { toast(err.response?.data?.message || 'Could not update the top-up.', 'error'); }
        setBusy(null);
    };
    const decideClient = async (t, approve) => {
        if (busy) return;
        setBusy(t._id);
        try {
            if (approve) await walletService.adminApproveClientTopUp(t._id); else await walletService.adminRejectClientTopUp(t._id);
            toast(approve ? 'Client top-up approved.' : 'Client top-up rejected.', 'success');
            await load();
        } catch (err) { toast(err.response?.data?.message || 'Could not update the top-up.', 'error'); }
        setBusy(null);
    };

    const pending = (list) => list.filter((t) => t.status === 'pending').length;
    return (
        <>
            <PageHead title="Wallets">
                <button type="button" className="btn-primary" onClick={() => setAdjust({})}>Credit or debit a business</button>
            </PageHead>
            <div className="adm-stack">
                <Kpis items={[
                    { label: 'Held for businesses', value: summary ? money(summary.totalHeld) : '—' },
                    { label: 'Business accounts', value: summary ? count(summary.walletCount) : '—' },
                    { label: 'Top-ups to approve', value: summary ? count(summary.pendingTopUps) : '—' },
                ]} />

                <Panel title="Top-ups from businesses" aside={topUps && <span className="adm-meta">{pending(topUps)} pending</span>}>
                    {!topUps ? <Empty>Loading…</Empty> : !topUps.length ? <Empty>No top-ups yet.</Empty> : topUps.slice(0, 40).map((t) => (
                        <TopUpRow key={t._id} t={t} who={t.provider ? businessName(t.provider) : 'Business'} canDecide busy={busy === t._id}
                            onDecide={(ok) => decideBusiness(t, ok)}
                            proof={t.hasProof ? <ProofLink fetchLink={() => providerWalletService.getTopUpProof(t._id)} label={`View ${t.proofType === 'pdf' ? 'PDF' : 'proof'}`} /> : 'no proof attached'} />
                    ))}
                </Panel>

                <Panel title="Balances" aside={<span className="adm-meta">{count(wallets.length)} {wallets.length === 1 ? 'business' : 'businesses'}</span>}>
                    {!wallets.length ? <Empty>No balances yet. Use “Credit or debit a business” to add funds to any business.</Empty> : (
                        <div className="adm-scroll">
                            <table className="adm-table">
                                <thead><tr><th>Business</th><th className="num">Balance</th><th className="actions"><span className="sr-only">Actions</span></th></tr></thead>
                                <tbody>
                                    {wallets.map((w) => (
                                        <tr key={w._id}>
                                            <td><span className="strong">{w.provider ? businessName(w.provider) : '—'}</span><span className="adm-sub">{w.provider?.email}</span></td>
                                            <td className="num">{money(w.balance)}</td>
                                            <td className="actions"><button type="button" className="adm-link" onClick={() => w.provider && setAdjust({ provider: w.provider })}>Credit or debit</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>

                <Panel title="Client wallet top-ups" aside={<span className="adm-meta">{FEATURES.walletEnabled ? `${pending(clientTopUps)} pending` : 'Client wallet is off'}</span>}>
                    {!FEATURES.walletEnabled && <div className="adm-row"><span className="adm-muted">Clients pay businesses at the appointment for now. Earlier requests are shown read-only.</span></div>}
                    {!clientTopUps.length ? <Empty>No client top-ups.</Empty> : clientTopUps.slice(0, 40).map((t) => (
                        <TopUpRow key={t._id} t={t} who={`${t.customer?.name || 'Client'} → ${t.provider?.name || 'business'}`} canDecide={FEATURES.walletEnabled}
                            busy={busy === t._id} onDecide={(ok) => decideClient(t, ok)}
                            proof={t.hasProof ? 'proof attached (private to the client and the business)' : 'no proof attached'} />
                    ))}
                </Panel>
            </div>
            {adjust && (
                <WalletAdjustDialog
                    initial={adjust.provider || null}
                    searchProviders={(search) => userService.getAllUsers({ role: 'provider', search, limit: 20 }).then((r) => r.data.data || [])}
                    walletFor={(pid) => wallets.find((w) => String(w.provider?._id || w.provider) === String(pid))}
                    onClose={() => setAdjust(null)}
                    submit={async ({ provider, direction, amount, reason }) => {
                        const res = await providerWalletService.adjustBalance({ providerId: provider._id, amount, direction, reason });
                        setAdjust(null);
                        toast(walletToast(direction, amount, businessName(provider), res.data?.data?.balanceAfter), 'success');
                        load();
                    }}
                />
            )}
        </>
    );
};

export default Wallets;
