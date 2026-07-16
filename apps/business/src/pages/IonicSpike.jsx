// PHASE 0 SPIKE (throwaway) — proves killer (d): FullCalendar survives IonContent.
// The known failure: FullCalendar measures 0 height when first mounted inside an
// ion-content flex layout; calling getApi().updateSize() after mount fixes it.
// NOT part of the app; deleted before real Phase 4 work.
import { useRef, useEffect, useState } from 'react';
import { setupIonicReact, IonApp, IonContent } from '@ionic/react';
import '@ionic/react/css/core.css';
import '@bookplus/design-tokens/ionic-bridge.css';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';

setupIonicReact({});

export default function IonicSpike() {
    const calRef = useRef(null);
    const [sized, setSized] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => {
            try { calRef.current?.getApi()?.updateSize(); setSized(true); } catch { /* ignore */ }
        }, 60);
        return () => clearTimeout(t);
    }, []);
    const today = new Date().toISOString().slice(0, 10);
    return (
        <IonApp style={{ position: 'static', height: '100vh' }}>
            <IonContent id="cal-content" style={{ height: '100vh' }}>
                <div style={{ padding: '1rem' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)' }}>FullCalendar-in-IonContent spike {sized ? '(updateSize ✓)' : ''}</h2>
                    <FullCalendar
                        ref={calRef}
                        plugins={[timeGridPlugin, dayGridPlugin]}
                        initialView="timeGridWeek"
                        height="auto"
                        events={[{ title: 'Test appointment', start: `${today}T10:00:00`, end: `${today}T11:00:00` }]}
                    />
                </div>
            </IonContent>
        </IonApp>
    );
}
