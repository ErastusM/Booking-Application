import React from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { Crosshair } from 'lucide-react';

export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Windhoek — a sensible default centre for a Namibian marketplace until the
// business drops their own pin.
export const DEFAULT_CENTER = { lat: -22.5609, lng: 17.0658 };

// Turn coordinates into a readable address (free OSM reverse-geocode — no
// Google Geocoding bill). Best-effort; a failure just leaves the field as-is.
export const reverseGeocode = async (lat, lng) => {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
        );
        const d = await res.json();
        const a = d.address || {};
        return [a.road || a.pedestrian, a.house_number, a.suburb || a.neighbourhood,
            a.city || a.town || a.village, a.state, a.country].filter(Boolean).join(', ');
    } catch {
        return '';
    }
};

// Draggable Google-Maps pin. Isolated so its useJsApiLoader hook only runs when a
// key is configured (callers render a text fallback when MAPS_KEY is absent).
const MapPicker = ({ coordinates, onPick, height = 240 }) => {
    const { isLoaded, loadError } = useJsApiLoader({ id: 'gmaps', googleMapsApiKey: MAPS_KEY });
    const hasPin = coordinates && coordinates.lat != null;
    const center = hasPin ? coordinates : DEFAULT_CENTER;

    const locate = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => onPick({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => {},
            { timeout: 8000 }
        );
    };

    if (loadError) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Map couldn’t load — you can still type your address below.</p>;
    if (!isLoaded) return <div style={{ height, borderRadius: 'var(--radius)', background: 'var(--surface-sunken)' }} />;

    return (
        <div style={{ position: 'relative' }}>
            <GoogleMap
                mapContainerStyle={{ width: '100%', height, borderRadius: 'var(--radius)' }}
                center={center}
                zoom={hasPin ? 16 : 12}
                options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
                onClick={(e) => onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
            >
                {hasPin && (
                    <Marker
                        position={coordinates}
                        draggable
                        onDragEnd={(e) => onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
                    />
                )}
            </GoogleMap>
            <button
                type="button"
                onClick={locate}
                style={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.75rem', borderRadius: '999px', border: 'none', background: 'var(--card-bg)', color: 'var(--charcoal)', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'var(--font-body)' }}
            >
                <Crosshair size={14} /> My location
            </button>
        </div>
    );
};

export default MapPicker;
