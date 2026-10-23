import { createElement, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { onSocketEvent } from './socket';
import type { SosAlert } from '../types';
import { titleCase } from '../utils/format';

// A two-tone siren with Web Audio (no sound file). Browsers only allow it after the admin has
// clicked somewhere on the page, which they will have by the time an alert arrives.
let audioCtx: AudioContext | null = null;
function siren() {
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state !== 'running') void audioCtx.resume();
    const start = audioCtx.currentTime;
    for (let i = 0; i < 6; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = i % 2 ? 660 : 880;
      const t = start + i * 0.35;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.setValueAtTime(0.25, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    }
  } catch {
    // no audio available — the notification still shows
  }
}

// Mounted once in AdminLayout for admins who can see SOS alerts. A new SOS sounds a siren and
// shows a notification that stays until closed; every SOS change refreshes the SOS page and badge.
export function useSosRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['sos'] });

    const onAlert = (a: SosAlert) => {
      refresh();
      siren();
      const key = `sos-${a._id}`;
      notification.error({
        key,
        title: `SOS: ${a.user?.name || 'Someone'} (${titleCase(a.role)})`,
        description: [
          a.kind === 'sos' ? 'Pressed SOS' : `Calling ${titleCase(a.kind)}`,
          a.store?.name,
          a.order?.orderNumber,
          a.user?.phone,
        ].filter(Boolean).join(' · '),
        duration: 0,
        placement: 'topRight',
        actions: createElement(Button, {
          type: 'primary',
          danger: true,
          size: 'small',
          onClick: () => {
            notification.destroy(key);
            navigate('/sos');
          },
        }, 'Open SOS'),
      });
    };

    const offs = [
      onSocketEvent<SosAlert>('sos:alert', onAlert),
      onSocketEvent('sos:updated', refresh),
      onSocketEvent('sos:location', refresh),
      onSocketEvent('connect', refresh),
    ];
    return () => offs.forEach((off) => off());
  }, [enabled, queryClient, notification, navigate]);
}
