import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// Mock the Google Maps loader so the component renders its "map" without a real
// key or network: the script "loads" successfully, exactly the state in which a
// runtime key rejection (gm_authFailure) happens.
const loader = vi.fn(() => ({ isLoaded: true, loadError: undefined }));
vi.mock('@react-google-maps/api', () => ({
    useJsApiLoader: (...a) => loader(...a),
    GoogleMap: ({ children }) => <div data-testid="gmap">{children}</div>,
    Marker: () => <div data-testid="marker" />,
}));

import MapPicker from './MapPicker';

/**
 * useJsApiLoader can't see a RUNTIME key rejection (bad/restricted key, billing
 * off, API not enabled): the script loads fine, so it reports isLoaded=true and
 * no loadError, and Google greys the map + overlays its own error dialog. The
 * component instead listens for window.gm_authFailure and shows a tidy fallback.
 *
 * Order matters: the module records the auth failure in a module-level flag that
 * can't be reset here, so the happy-path test runs first, before the failure is
 * ever fired.
 */
const renderShown = () => {
    render(<MapPicker coordinates={{ lat: -22.5, lng: 17 }} onPick={() => {}} />);
    fireEvent.click(screen.getByTestId('show-map'));
};

describe('MapPicker', () => {
    it('loads nothing from Google until the owner taps "Show map"', () => {
        loader.mockClear();
        render(<MapPicker coordinates={{ lat: -22.5, lng: 17 }} onPick={() => {}} />);
        expect(loader).not.toHaveBeenCalled();
        expect(screen.queryByTestId('gmap')).toBeNull();
        fireEvent.click(screen.getByTestId('show-map'));
        expect(loader).toHaveBeenCalled();
        expect(screen.getByTestId('gmap')).toBeTruthy();
    });

    it('renders the map when the key is accepted', () => {
        renderShown();
        expect(screen.getByTestId('gmap')).toBeTruthy();
        expect(screen.queryByText(/type your address/i)).toBeNull();
    });

    it('falls back to the address hint when Google rejects the key at runtime', () => {
        renderShown();
        // Google fires this global when it rejects the key after the script loaded.
        act(() => { window.gm_authFailure(); });
        expect(screen.getByText(/type your address/i)).toBeTruthy();
        expect(screen.queryByTestId('gmap')).toBeNull(); // the broken map is gone → no Google dialog container
    });
});
