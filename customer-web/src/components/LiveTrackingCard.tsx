import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Phone } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as ordersApi from '../api/orders';
import { onSocketEvent } from '../realtime/socket';
import type { DeliveryLocationEvent, Order, OrderTracking } from '../types';

const TRACKABLE = ['placed', 'accepted', 'picking', 'partially_picked', 'packed', 'assigned', 'picked_up', 'out_for_delivery'];
const RIDER_ON_JOB = ['assigned', 'picked_up', 'out_for_delivery'];

const COLORS = { hub: '#158a4d', drop: '#2563eb', rider: '#ea580c' };

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Map with the store, your address and (once a rider is on the way) the rider's live position,
// plus the ETA. Rider pings arrive as 'delivery:location' socket events and move the marker.
function TrackingMapView({ tracking }: { tracking: OrderTracking }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: false, attributionControl: true }).setView([22.5, 79], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      // A new map (StrictMode re-mount, or remount) must fit its markers again.
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    const add = (lat: number, lng: number, color: string, label: string) => {
      L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(layer);
      pts.push([lat, lng]);
    };
    if (tracking.hub) add(tracking.hub.lat, tracking.hub.lng, COLORS.hub, tracking.hub.name);
    if (tracking.drop) add(tracking.drop.lat, tracking.drop.lng, COLORS.drop, 'You');
    if (tracking.rider) add(tracking.rider.lat, tracking.rider.lng, COLORS.rider, tracking.deliveryPartner?.name?.split(' ')[0] || 'Rider');
    if (pts.length && !fitted.current) {
      map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 15 });
      fitted.current = true;
    }
  }, [tracking]);

  return <div ref={ref} className="h-56 w-full overflow-hidden rounded-lg" style={{ zIndex: 0 }} />;
}

export default function LiveTrackingCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const active = TRACKABLE.includes(order.orderStatus);
  const key = ['order-tracking', order._id];

  const { data: tracking } = useQuery({
    queryKey: key,
    queryFn: () => ordersApi.getTracking(order._id),
    enabled: active,
    refetchInterval: 60000,
  });

  // Status changes re-run the ETA server-side; rider pings update position + ETA in place.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['order-tracking', order._id] });
  }, [order.orderStatus, order._id, queryClient]);

  useEffect(() => {
    return onSocketEvent<DeliveryLocationEvent>('delivery:location', (e) => {
      if (e.orderId !== order._id) return;
      queryClient.setQueryData<OrderTracking>(['order-tracking', order._id], (prev) =>
        prev ? { ...prev, rider: { lat: e.lat, lng: e.lng, updatedAt: e.updatedAt }, eta: e.eta ?? prev.eta } : prev,
      );
    });
  }, [order._id, queryClient]);

  if (!active || !tracking) return null;

  const eta = tracking.eta;
  const riderOnJob = RIDER_ON_JOB.includes(order.orderStatus);
  const hasMap = !!(tracking.hub || tracking.drop || tracking.rider);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">
            {tracking.arrivedAtDropAt ? 'Your delivery partner has arrived' : eta ? `Arriving in ${eta.etaMinutes} min` : 'Tracking your order'}
          </h2>
          {eta && !tracking.arrivedAtDropAt && (
            <p className="text-sm text-gray-500">
              Expected by {formatTime(eta.etaAt)}
              {eta.remainingKm !== null && ` · ${eta.remainingKm} km away`}
              {eta.approximate && ' · estimate'}
            </p>
          )}
        </div>
        {riderOnJob && tracking.deliveryPartner && (
          <div className="flex items-center gap-2 text-sm">
            <Bike className="h-4 w-4 text-orange-600" />
            <span className="font-medium text-gray-800">{tracking.deliveryPartner.name}</span>
            {tracking.deliveryPartner.phone && (
              <a href={`tel:${tracking.deliveryPartner.phone}`} className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                <Phone className="h-3 w-3" /> Call
              </a>
            )}
          </div>
        )}
      </div>

      {hasMap && <TrackingMapView tracking={tracking} />}
      {riderOnJob && !tracking.rider && (
        <p className="mt-2 text-xs text-gray-500">The rider's live location will show here once their app shares it.</p>
      )}
      {!tracking.drop && (
        <p className="mt-2 text-xs text-gray-500">Tip: save your address with your location (Addresses → Use my current location) for a more accurate ETA.</p>
      )}
    </section>
  );
}
