import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Small Leaflet wrapper for the tracking views (order drawer, Live Map). OpenStreetMap tiles, no
// API key. Markers are plain circles (no image assets to bundle), coloured by kind.
export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  kind: 'hub' | 'drop' | 'rider' | 'rider-stale';
  label: string;
}

export interface MapCircle {
  id: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

const COLORS: Record<MapPoint['kind'], string> = {
  hub: '#158a4d',
  drop: '#2563eb',
  rider: '#ea580c',
  'rider-stale': '#9ca3af',
};

interface Props {
  points: MapPoint[];
  circles?: MapCircle[];
  height?: number;
  // Labels always visible (few markers) or on hover (many).
  labels?: 'always' | 'hover';
  // The view re-fits to all markers whenever this changes (and on first data).
  fitKey?: string;
  onPointClick?: (id: string) => void;
}

export default function TrackingMap({ points, circles = [], height = 280, labels = 'hover', fitKey, onPointClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([22.5, 79], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      // A new map (StrictMode re-mount, or remount) must fit its markers again.
      fittedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    circles.forEach((c) => {
      L.circle([c.lat, c.lng], { radius: c.radiusKm * 1000, color: COLORS.hub, weight: 1, fillOpacity: 0.05, dashArray: '4 4' }).addTo(layer);
    });
    points.forEach((p) => {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: p.kind === 'hub' ? 9 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: COLORS[p.kind],
        fillOpacity: 1,
      })
        .bindTooltip(p.label, { permanent: labels === 'always', direction: 'top', offset: [0, -8] })
        .addTo(layer);
      if (onPointClick) marker.on('click', () => onPointClick(p.id));
    });

    const key = fitKey ?? 'default';
    if (points.length && fittedRef.current !== key) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.25), { maxZoom: 15 });
      fittedRef.current = key;
    }
  }, [points, circles, labels, fitKey, onPointClick]);

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: 8, overflow: 'hidden', zIndex: 0 }} />;
}
