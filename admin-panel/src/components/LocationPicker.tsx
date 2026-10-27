import { useEffect, useRef, useState } from 'react';
import { Button, Input, List, Space, Typography, App as AntApp } from 'antd';
import { AimOutlined, EnvironmentOutlined } from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { searchPlaces, type Place } from '../api/stores';

// Pick a location by name instead of typing coordinates: search an area / street / city (or use
// this device's location), then drag the pin — or click the map — to the exact spot. Works as an
// antd Form control: `value` / `onChange` are { lat, lng } or null. OpenStreetMap tiles like
// TrackingMap; the pin is a CSS div icon (index.css .location-pin), so no image assets to bundle.

export interface LatLng {
  lat: number;
  lng: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const PIN = L.divIcon({ className: 'location-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 34] });

export default function LocationPicker({ value, onChange }: { value?: LatLng | null; onChange?: (value: LatLng | null) => void }) {
  const { message } = AntApp.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // The map's click / drag handlers are bound once, so they call the latest onChange through this.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  const setPoint = (lat: number, lng: number) => onChangeRef.current?.({ lat: round6(lat), lng: round6(lng) });

  const goTo = (lat: number, lng: number) => {
    mapRef.current?.setView([lat, lng], 17);
    setPoint(lat, lng);
  };

  useEffect(() => {
    const map = L.map(containerRef.current!, { zoomControl: true }).setView([22.5, 79], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => setPoint(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    // In a Modal the map is created before its box has a size (and kept while hidden) — re-measure.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current!);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // The pin follows the value. The view zooms in on it when it first appears (a store that already
  // has a location) or would be off-screen (another store opened in the form) — never mid-drag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const at = L.latLng(value.lat, value.lng);
    const isNew = !markerRef.current;
    if (!markerRef.current) {
      const marker = L.marker(at, { draggable: true, icon: PIN, autoPan: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        setPoint(p.lat, p.lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(at);
    }
    if (isNew || !map.getBounds().contains(at)) map.setView(at, Math.max(map.getZoom(), 16));
  }, [value]);

  const search = async (text: string) => {
    if (text.trim().length < 3) {
      message.info('Type at least 3 letters — an area, street or city');
      return;
    }
    setSearching(true);
    try {
      const places = await searchPlaces(text.trim());
      setResults(places);
      if (places.length === 1) {
        goTo(places[0].lat, places[0].lng);
        setResults(null);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Place search failed');
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      message.error('This browser cannot share its location');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setResults(null);
        goTo(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
        message.error('Could not get this device\'s location — allow location access, or search instead');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div>
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input.Search
          placeholder="Search area, street or city — e.g. Vijay Nagar, Indore"
          enterButton="Search"
          loading={searching}
          allowClear
          onSearch={search}
          onChange={(e) => !e.target.value && setResults(null)}
        />
        <Button icon={<AimOutlined />} loading={locating} onClick={useMyLocation} title="Use this device's location (when you are at the store)">
          My location
        </Button>
      </Space.Compact>

      {results && (
        <List
          size="small"
          bordered
          style={{ marginBottom: 8, maxHeight: 200, overflowY: 'auto', background: '#fff' }}
          locale={{ emptyText: 'No places found — try a nearby landmark, or click the map' }}
          dataSource={results}
          renderItem={(p) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => {
                goTo(p.lat, p.lng);
                setResults(null);
              }}
            >
              <Space align="start">
                <EnvironmentOutlined style={{ color: '#16a34a', marginTop: 4 }} />
                <span>{p.label}</span>
              </Space>
            </List.Item>
          )}
        />
      )}

      <div ref={containerRef} style={{ height: 260, borderRadius: 8, border: '1px solid #d9d9d9', overflow: 'hidden' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {value
            ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)} — drag it (or click the map) to the store's exact entrance`
            : 'No location yet — search above, use My location, or click the map'}
        </Typography.Text>
        {value && (
          <Typography.Link style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => onChangeRef.current?.(null)}>
            Remove pin
          </Typography.Link>
        )}
      </div>
    </div>
  );
}
