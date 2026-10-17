import { useEffect, useRef, useState } from 'react';

// Shared bits for the dashboard charts: colour roles, number formats, scales.
// Colours are the validated reference palette (light mode only — the admin panel has no dark
// theme): one series hue, an ordinal ramp for ordered stages, recessive chart chrome.
export const CHART = {
  series: '#2a78d6',
  seriesWash: 'rgba(42, 120, 214, 0.10)',
  deEmphasis: '#c3c2b7',
  // Ordinal blue ramp (light → dark), validated with --ordinal against #ffffff.
  ordinal: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
  grid: '#eeede8',
  axis: '#c3c2b7',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  surface: '#ffffff',
  good: '#006300',
  bad: '#d03b3b',
};

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const fmtCount = (n: number) => (Math.abs(n) >= 10000 ? compact.format(n) : whole.format(n));
export const fmtRupees = (n: number) => `₹${Math.abs(n) >= 10000 ? compact.format(n) : whole.format(Math.round(n))}`;
export const fmtRupeesExact = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`;

// A "nice" axis maximum and ~4 evenly spaced ticks from 0.
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// Width of an element, kept current as it resizes.
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// SVG path for a bar with a 4px rounded top and a square base.
export function roundedTopBar(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
