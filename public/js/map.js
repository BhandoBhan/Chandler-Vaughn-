// Maps use Leaflet + OpenStreetMap tiles, loaded from a CDN in index.html.
// If Leaflet didn't load, callers fall back to lists and buttons.

export const FORMAT_COLORS = { '3v3': '#e8590c', '8v8': '#1c7ed6', '11v11': '#7048e8' };
const US_CENTER = { lat: 39.8, lng: -98.6 };

export function mapsAvailable() {
  return typeof window.L !== 'undefined';
}

export function createMap(element, center, zoom = 12) {
  if (!mapsAvailable()) return null;
  const L = window.L;
  const start = center || US_CENTER;
  const map = L.map(element, { scrollWheelZoom: false }).setView([start.lat, start.lng], center ? zoom : 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

export function dot(map, { lat, lng }, { color = '#0b7a4b', radius = 9, title } = {}) {
  const marker = window.L.circleMarker([lat, lng], {
    radius,
    color: '#ffffff',
    weight: 2,
    fillColor: color,
    fillOpacity: 1,
  }).addTo(map);
  if (title) marker.bindTooltip(title);
  return marker;
}

export function fitTo(map, points) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 13);
    return;
  }
  map.fitBounds(
    points.map((p) => [p.lat, p.lng]),
    { padding: [32, 32], maxZoom: 14 },
  );
}

// Address / place search via OpenStreetMap's Nominatim service. Fine for
// light use; switch to a commercial geocoder before launching widely.
export async function searchPlaces(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Location search is unavailable right now');
  const results = await res.json();
  return results.map((r) => ({
    label: r.display_name,
    shortLabel: r.display_name.split(',').slice(0, 2).join(','),
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Your browser can't share its location"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Couldn't get your location — allow location access or search instead")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export function directionsUrl({ lat, lng }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
