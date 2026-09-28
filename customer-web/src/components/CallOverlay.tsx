import { useEffect, useState } from 'react';
import { Bike, Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import { useVoipStore, type CallView } from '../voip/voipStore';

function useElapsed(since?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function statusText(call: CallView, elapsed: string | null) {
  switch (call.phase) {
    case 'connecting': return 'Connecting…';
    case 'ringing': return call.direction === 'incoming' ? 'is calling you' : 'Ringing…';
    case 'active': return elapsed ?? 'Connected';
    default: return call.message || 'Call ended';
  }
}

const roundBtn = 'inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition disabled:opacity-50';

// In-app call with the delivery partner (voip/voipStore.ts). Numbers are never shown — only the
// rider's first name and the order.
export default function CallOverlay() {
  const call = useVoipStore((s) => s.call);
  const { accept, decline, hangUp, toggleMute, dismiss } = useVoipStore.getState();
  const elapsed = useElapsed(call?.phase === 'active' ? call.answeredAt : undefined);
  if (!call) return null;

  const incomingRinging = call.direction === 'incoming' && call.phase === 'ringing';
  const ended = call.phase === 'ended';

  return (
    <div role="dialog" aria-label="Call" className="fixed inset-x-4 bottom-4 z-[1000] sm:inset-x-auto sm:right-6 sm:w-80">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-100">
            <Bike className="h-5 w-5 text-orange-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-gray-900">{call.name}</p>
            <p className="text-xs text-gray-500">
              Delivery partner{call.orderNumber ? ` · ${call.orderNumber}` : ''}
            </p>
            <p className={`mt-1 text-sm ${ended && call.message ? 'text-gray-700' : 'text-gray-600'}`} aria-live="polite">
              {statusText(call, elapsed)}
            </p>
          </div>
          {ended && (
            <button type="button" onClick={dismiss} aria-label="Close" className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!ended && (
          <div className="mt-4 flex items-center justify-center gap-6">
            {incomingRinging ? (
              <>
                <button type="button" onClick={decline} aria-label="Decline" className={`${roundBtn} bg-red-600 hover:bg-red-700`}>
                  <PhoneOff className="h-5 w-5" />
                </button>
                <button type="button" onClick={accept} aria-label="Answer" className={`${roundBtn} bg-green-600 hover:bg-green-700`}>
                  <Phone className="h-5 w-5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleMute}
                  disabled={call.phase !== 'active'}
                  aria-label={call.muted ? 'Unmute' : 'Mute'}
                  aria-pressed={call.muted}
                  className={`${roundBtn} ${call.muted ? 'bg-gray-800' : 'bg-gray-400 hover:bg-gray-500'}`}
                >
                  {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button type="button" onClick={hangUp} aria-label="Hang up" className={`${roundBtn} bg-red-600 hover:bg-red-700`}>
                  <PhoneOff className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        )}
        <p className="mt-3 text-center text-[11px] text-gray-400">Private call: your number is not shared</p>
      </div>
    </div>
  );
}
