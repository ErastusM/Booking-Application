// A Google Maps link for a provider address — opens the location on the map,
// where the customer can tap "Directions" to drive there. Returns '#' if empty.
export const mapsUrl = (address) =>
    address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '#';
