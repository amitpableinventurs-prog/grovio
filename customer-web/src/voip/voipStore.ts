import { create } from 'zustand';
import type { Call, Device } from '@twilio/voice-sdk';
import * as voipApi from '../api/voip';
import { apiErrorMessage } from '../api/client';

// In-app calls with the delivery partner over Twilio Voice (backend services/voip.service.js).
// Neither side sees the other's number: we only ever know the rider's first name.
//
// The Twilio Device lives here, outside React: useVoip() (mounted once in MainLayout) starts it
// while a customer is logged in, so riders can call in while the site is open, and CallOverlay
// renders whatever call is in progress.

export type CallPhase = 'connecting' | 'ringing' | 'active' | 'ended';

export interface CallView {
  direction: 'incoming' | 'outgoing';
  phase: CallPhase;
  name: string;
  orderNumber?: string;
  answeredAt?: number;
  muted: boolean;
  // Why the call ended, when it's worth saying.
  message?: string;
}

interface VoipState {
  enabled: boolean;
  call: CallView | null;
  callRider: (orderId: string) => Promise<void>;
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  dismiss: () => void;
}

let device: Device | null = null;
let current: Call | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;

const isBusy = () => {
  const view = useVoipStore.getState().call;
  return !!current || (!!view && view.phase !== 'ended');
};

function update(patch: Partial<CallView>) {
  useVoipStore.setState((s) => (s.call ? { call: { ...s.call, ...patch } } : s));
}

function show(call: CallView) {
  clearTimeout(dismissTimer);
  useVoipStore.setState({ call });
}

function end(message?: string) {
  current = null;
  update({ phase: 'ended', message });
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => useVoipStore.getState().dismiss(), message ? 5000 : 2500);
}

// Wires a Twilio Call (either direction) to the view.
function attach(call: Call) {
  current = call;
  call.on('ringing', () => update({ phase: 'ringing' }));
  call.on('accept', () => update({ phase: 'active', answeredAt: Date.now() }));
  call.on('mute', (muted: boolean) => update({ muted }));
  call.on('disconnect', () => end());
  call.on('cancel', () => end('Missed call'));
  call.on('reject', () => end());
  call.on('error', (err: { message?: string }) => end(err?.message || 'The call dropped'));
}

export const useVoipStore = create<VoipState>(() => ({
  enabled: false,
  call: null,

  callRider: async (orderId) => {
    if (isBusy()) return;
    show({ direction: 'outgoing', phase: 'connecting', name: 'Delivery partner', muted: false });
    try {
      const started = await voipApi.callDeliveryPartner(orderId);
      update({ name: started.callee.name, orderNumber: started.orderNumber });
      if (started.simulated) {
        end('Test mode: in-app calling is not set up, so no call was placed.');
        return;
      }
      if (!device) throw new Error('Calling is still starting up. Please try again in a moment.');
      attach(await device.connect({ params: started.params }));
    } catch (err) {
      end(apiErrorMessage(err, err instanceof Error ? err.message : 'Could not start the call'));
    }
  },

  accept: () => current?.accept(),
  decline: () => {
    current?.reject();
    end();
  },
  hangUp: () => {
    if (current) current.disconnect();
    else end();
  },
  toggleMute: () => current?.mute(!current.isMuted()),
  dismiss: () => {
    clearTimeout(dismissTimer);
    if (!current) useVoipStore.setState({ call: null });
  },
}));

// Starts the Twilio Device for the logged-in customer. Returns a cleanup function.
export async function startDevice(): Promise<() => void> {
  const token = await voipApi.getVoipToken().catch(() => null);
  if (!token?.enabled || !token.token) {
    useVoipStore.setState({ enabled: false });
    return () => {};
  }

  // Loaded only when calling is switched on — it's a large bundle.
  const { Device: TwilioDevice } = await import('@twilio/voice-sdk');
  const d = new TwilioDevice(token.token, { closeProtection: 'You are on a call. Leave this page and hang up?' });
  device = d;

  d.on('tokenWillExpire', async () => {
    const next = await voipApi.getVoipToken().catch(() => null);
    if (next?.token) d.updateToken(next.token);
  });

  d.on('incoming', (call: Call) => {
    if (isBusy()) {
      call.reject();
      return;
    }
    const p = call.customParameters;
    show({
      direction: 'incoming',
      phase: 'ringing',
      name: p.get('callerName') || 'Your delivery partner',
      orderNumber: p.get('orderNumber') || undefined,
      muted: false,
    });
    attach(call);
  });

  d.on('error', (err: { message?: string }) => console.warn('Twilio Device error:', err?.message));

  await d.register().catch((err) => console.warn('Could not register for incoming calls:', err?.message));
  useVoipStore.setState({ enabled: true });

  return () => {
    current?.disconnect();
    current = null;
    d.destroy();
    if (device === d) device = null;
    useVoipStore.setState({ enabled: false, call: null });
  };
}
