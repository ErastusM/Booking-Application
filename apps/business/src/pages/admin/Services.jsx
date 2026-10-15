import React, { useEffect, useState } from 'react';
import { formatDuration, useConfirm } from '@bookplus/ui';
import { serviceService } from '../../services';
import { useToast } from '../../components/Toast';
import { PageHead, Panel, Empty } from '../../components/admin/ui';
import { money } from './format';

// Every bookable service on the marketplace. An admin can add a Bookplus-wide
// service (no business) and edit or remove any service.

const EMPTY = { name: '', description: '', price: '', duration: '' };

const Services = () => {
    const toast = useToast();
    const confirm = useConfirm();
    const [rows, setRows] = useState(null);
    const [form, setForm] = useState(null); // null = closed; { ...fields, _id? }
    const [busy, setBusy] = useState(null);

    const load = () => serviceService.getAllServices().then((r) => setRows(r.data.data)).catch(() => { setRows([]); toast('Could not load services.', 'error'); });
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const save = async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy('form');
        try {
            const { _id, ...fields } = form;
            if (_id) await serviceService.updateService(_id, fields); else await serviceService.createService(fields);
            toast(_id ? 'Service saved.' : 'Service added.', 'success');
            setForm(null);
            await load();
        } catch { toast('Could not save the service.', 'error'); }
        setBusy(null);
    };
    const remove = async (s) => {
        if (busy || !(await confirm({ title: `Delete “${s.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
        setBusy(s._id);
        try {
            await serviceService.deleteService(s._id);
            setRows((rs) => rs.filter((r) => r._id !== s._id));
            toast('Service deleted.', 'success');
        } catch { toast('Could not delete the service.', 'error'); }
        setBusy(null);
    };
    const field = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) });

    return (
        <>
            <PageHead title="Services">
                {!form && <button type="button" className="btn-primary" onClick={() => setForm({ ...EMPTY })}>Add a service</button>}
            </PageHead>
            <div className="adm-stack">
                {form && (
                    <Panel title={form._id ? `Edit ${form.name || 'service'}` : 'Add a Bookplus service'}>
                        <form onSubmit={save} className="adm-panel-body" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
                            <div style={{ gridColumn: '1 / -1' }}><label className="adm-label" htmlFor="svc-name">Name</label><input id="svc-name" className="adm-input" required {...field('name')} /></div>
                            <div style={{ gridColumn: '1 / -1' }}><label className="adm-label" htmlFor="svc-desc">Description</label><textarea id="svc-desc" className="adm-input" rows={2} required {...field('description')} /></div>
                            <div><label className="adm-label" htmlFor="svc-price">Price (N$)</label><input id="svc-price" className="adm-input" type="number" min="0" step="0.01" required {...field('price')} /></div>
                            <div><label className="adm-label" htmlFor="svc-duration">Duration (minutes)</label><input id="svc-duration" className="adm-input" type="number" min="5" step="5" required {...field('duration')} /></div>
                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                                <button type="submit" className="btn-primary" disabled={busy === 'form'}>{form._id ? 'Save' : 'Add'}</button>
                                <button type="button" className="btn-outline" onClick={() => setForm(null)}>Cancel</button>
                            </div>
                        </form>
                    </Panel>
                )}
                <Panel>
                    {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No services yet.</Empty> : (
                        <div className="adm-scroll">
                            <table className="adm-table wide">
                                <thead><tr><th>Service</th><th>Business</th><th className="num">Price</th><th className="num">Duration</th><th className="actions"><span className="sr-only">Actions</span></th></tr></thead>
                                <tbody>
                                    {rows.map((s) => (
                                        <tr key={s._id}>
                                            <td style={{ maxWidth: '22rem' }}>
                                                <span className="strong">{s.name}</span>
                                                {s.description && <span className="adm-sub" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</span>}
                                            </td>
                                            <td>{s.provider?.name || <span className="dim">Bookplus</span>}</td>
                                            <td className="num">{money(s.price)}</td>
                                            <td className="num">{formatDuration(s.duration)}</td>
                                            <td className="actions">
                                                <button type="button" className="adm-link" onClick={() => setForm({ _id: s._id, name: s.name, description: s.description, price: s.price, duration: s.duration })}>Edit</button>
                                                <button type="button" className="adm-link" data-tone="bad" disabled={busy === s._id} onClick={() => remove(s)}>Delete</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
            </div>
        </>
    );
};

export default Services;
