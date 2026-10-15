import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Select } from '@bookplus/ui';
import { appointmentService } from '../../services';
import { useToast } from '../../components/Toast';
import { appointmentBusiness, appointmentClient } from '../../utils/adminPanel';
import { PageHead, Panel, Seg, Empty } from '../../components/admin/ui';
import { useAdminData } from './adminData';
import { BOOKING_STATUS, bookingDay, count, money } from './format';

// Every booking on the platform, newest first, with its business and client.
// An admin can change a booking's status (e.g. to sort out a dispute).

const FILTERS = [['', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['no-show', 'No-show']];
const STATUS_OPTIONS = FILTERS.slice(1).map(([value, label]) => ({ value, label }));

export const Pager = ({ page, pages, onChange }) => (pages > 1 ? (
    <div className="adm-bar" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn-outline" onClick={() => onChange(page - 1)} disabled={page <= 1}>Previous</button>
        <span className="adm-meta">Page {page} of {pages}</span>
        <button type="button" className="btn-outline" onClick={() => onChange(page + 1)} disabled={page >= pages}>Next</button>
    </div>
) : null);

const Bookings = () => {
    const toast = useToast();
    const { refresh } = useAdminData();
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [rows, setRows] = useState(null);
    const [meta, setMeta] = useState({ total: 0, pages: 1 });
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState('');

    // Only the latest request may fill the table (filters and paging overlap).
    const seq = useRef(0);
    const load = useCallback(async () => {
        const n = ++seq.current;
        try {
            const res = await appointmentService.getAllAppointments({ page, ...(status ? { status } : {}) });
            if (n !== seq.current) return;
            setRows(res.data.data);
            setMeta({ total: res.data.total, pages: res.data.pages || 1 });
            setError('');
        } catch { if (n === seq.current) { setError('Could not load bookings.'); setRows([]); } }
    }, [page, status]);
    useEffect(() => { load(); }, [load]);

    const change = async (a, next) => {
        if (busy === a._id || next === a.status) return;
        setBusy(a._id);
        try {
            await appointmentService.updateAppointmentStatus(a._id, next);
            setRows((rs) => rs.map((r) => (r._id === a._id ? { ...r, status: next } : r)));
            toast('Status changed.', 'success');
            refresh();
        } catch { toast('Could not change the status.', 'error'); }
        setBusy(null);
    };

    return (
        <>
            <PageHead title="Bookings" />
            <div className="adm-stack">
                <div className="adm-bar">
                    <Seg label="Status" options={FILTERS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
                    <span className="adm-meta">{count(meta.total)} {status ? (BOOKING_STATUS[status]?.[0] || '').toLowerCase() : 'in total'}</span>
                </div>
                {error && <div role="alert" className="adm-error">{error}</div>}
                <Panel>
                    {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No bookings found.</Empty> : (
                        <div className="adm-scroll">
                            <table className="adm-table wide">
                                <thead><tr><th>Client</th><th>Business</th><th>Service</th><th>When</th><th className="num">Price</th><th>Status</th></tr></thead>
                                <tbody>
                                    {rows.map((a) => {
                                        const client = appointmentClient(a);
                                        const biz = appointmentBusiness(a);
                                        return (
                                            <tr key={a._id}>
                                                <td>
                                                    <span className={client.missing ? 'dim' : 'strong'} style={client.missing ? { fontStyle: 'italic' } : undefined}>{client.name}</span>
                                                    {client.tag && <span className="adm-tag">{client.tag}</span>}
                                                    {client.email && <span className="adm-sub">{client.email}</span>}
                                                    <span className="adm-sub" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                                                        Ref {a.bookingReference || (a._id ? a._id.slice(-8).toUpperCase() : '—')}
                                                    </span>
                                                </td>
                                                <td className={biz.removed ? 'dim' : undefined} style={biz.removed ? { fontStyle: 'italic' } : undefined}>
                                                    {biz.name}{biz.suspended && <span className="adm-tag">Suspended</span>}
                                                </td>
                                                <td>{a.service?.name}</td>
                                                <td className="nowrap">{bookingDay(a.appointmentDate)}<span className="adm-sub">{a.startTime} – {a.endTime}</span></td>
                                                <td className="num">{money(a.totalPrice)}</td>
                                                <td>
                                                    <Select value={a.status} onChange={(e) => change(a, e.target.value)} options={STATUS_OPTIONS} size="sm"
                                                        aria-label="Appointment status" disabled={busy === a._id}
                                                        style={{ width: 'auto', minWidth: '7.5rem', fontSize: '0.78rem', borderWidth: '1px' }} />
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
        </>
    );
};

export default Bookings;
