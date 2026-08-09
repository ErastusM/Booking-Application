import React from 'react';
import { reportError } from '../utils/errorReporter';

// Catches render-time crashes anywhere below it so a single broken component
// shows a friendly recovery screen instead of a blank white page — and reports
// the error so we find out it happened. (Event-handler / async errors are caught
// separately by the window handlers in errorReporter.)
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error) {
        reportError(error, 'render');
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div style={{
                minHeight: '100dvh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                padding: '2rem', gap: '0.5rem', background: 'var(--off-white)', color: 'var(--charcoal)',
                fontFamily: 'var(--font-body)',
            }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
                    Something went wrong
                </h1>
                <p style={{ color: 'var(--text-muted)', maxWidth: '32ch', margin: '0.25rem 0 1.25rem' }}>
                    Sorry — that page hit an unexpected error. Reloading usually fixes it.
                </p>
                <button className="btn-primary" onClick={() => window.location.reload()}>
                    Reload
                </button>
            </div>
        );
    }
}

export default ErrorBoundary;
