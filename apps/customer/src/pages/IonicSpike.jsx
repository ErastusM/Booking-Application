// PHASE 0 SPIKE (throwaway) — proves killer (b): the token bridge makes Ionic
// components render in the Bookplus brand. NOT part of the app; this file + its
// route are deleted before any real Phase 3 work. Import Ionic's core CSS then
// the bridge (tokens.css is already global from main.jsx).
import { setupIonicReact, IonApp, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonToggle, IonItem, IonLabel, IonList, IonTabBar, IonTabButton } from '@ionic/react';
import '@ionic/react/css/core.css';
import '@bookplus/design-tokens/ionic-bridge.css';

setupIonicReact({});

export default function IonicSpike() {
    const toggleDark = () => document.body.classList.toggle('dark-mode');
    return (
        <IonApp style={{ position: 'static', minHeight: '100vh' }}>
            <div style={{ padding: '1.5rem', maxWidth: 480, margin: '0 auto' }}>
                <button onClick={toggleDark} style={{ marginBottom: 16, padding: '8px 12px' }}>Toggle dark mode</button>
                <h2 style={{ fontFamily: 'var(--font-display)' }}>Ionic token-bridge spike</h2>

                <IonButton id="btn-dark" color="dark" expand="block">Primary CTA (color=dark → should be black)</IonButton>
                <IonButton id="btn-primary" color="primary" expand="block">Accent (color=primary → should be orange)</IonButton>

                <IonCard id="card-1">
                    <IonCardHeader><IonCardTitle>Card title</IonCardTitle></IonCardHeader>
                    <IonCardContent>A white card on the gray surface — the brand's card model.</IonCardContent>
                </IonCard>

                <IonList id="list-1">
                    <IonItem>
                        <IonLabel>Notifications</IonLabel>
                        <IonToggle id="tog-1" checked />
                    </IonItem>
                </IonList>

                <IonTabBar id="tabbar-1">
                    <IonTabButton tab="home"><IonLabel>Home</IonLabel></IonTabButton>
                    <IonTabButton tab="book"><IonLabel>Bookings</IonLabel></IonTabButton>
                    <IonTabButton tab="profile"><IonLabel>Profile</IonLabel></IonTabButton>
                </IonTabBar>
            </div>
        </IonApp>
    );
}
