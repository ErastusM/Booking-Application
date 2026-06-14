import React, { useEffect, useState } from 'react';
import { formService } from '../services';

// Compact provider-side view of intake/consent forms attached to an
// appointment, with completion status and submitted answers.
const ApptFormsView = ({ appointmentId }) => {
    const [forms, setForms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(null); // template id whose answers are expanded

    useEffect(() => {
        let alive = true;
        formService.getFormsForAppointment(appointmentId)
            .then(res => { if (alive) setForms(res.data.data || []); })
            .catch(() => {})
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [appointmentId]);

    if (loading || forms.length === 0) return null;

    return (
        <div style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem', fontFamily: 'Outfit, sans-serif' }}>Forms</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {forms.map(({ template, completed, submission }) => (
                    <div key={template._id}>
                        <div
                            onClick={() => completed && setOpen(open === template._id ? null : template._id)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: completed ? 'pointer' : 'default' }}
                        >
                            <span style={{ fontSize: '0.85rem', color: 'var(--charcoal)', fontWeight: '500' }}>{template.title}</span>
                            <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.15rem 0.55rem', borderRadius: '99px', background: completed ? '#d1fae5' : '#fef3c7', color: completed ? '#065f46' : '#92400e' }}>
                                {completed ? '✓ Completed' : 'Pending'}
                            </span>
                        </div>
                        {completed && open === template._id && submission && (
                            <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                {submission.answers.map((a, i) => (
                                    <div key={i}>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{a.label}</p>
                                        <p style={{ fontSize: '0.82rem', color: 'var(--charcoal)', margin: 0 }}>
                                            {a.value === true ? 'Yes' : a.value === false ? 'No' : (Array.isArray(a.value) ? a.value.join(', ') : (a.value || '—'))}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ApptFormsView;
