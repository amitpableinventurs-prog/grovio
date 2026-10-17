import { useState } from 'react';
import { CHART, niceTicks, useElementWidth } from './chartKit';

export interface TrendPoint {
  key: string;
  label: string; // x-axis / tooltip label
  value: number;
  detail?: string; // secondary tooltip line
}

interface Props {
  points: TrendPoint[];
  height?: number;
  format: (n: number) => string;
  seriesName: string;
  // Appended to the end-of-line value label, e.g. " today so far" when the last bucket is partial.
  lastSuffix?: string;
}

const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

// Single-series area + line over time, with a crosshair that snaps to the nearest point.
// The last value is labelled at the line end; everything else is in the tooltip / table view.
export default function TrendChart({ points, height = 260, format, seriesName, lastSuffix = '' }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = height - PAD.top - PAD.bottom;
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), 0));
  const top = ticks[ticks.length - 1];
  const n = points.length;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = n ? `${line} L${x(n - 1)},${PAD.top + plotH} L${x(0)},${PAD.top + plotH} Z` : '';

  // At most ~7 x labels, always including the last; drop one that would crowd the last.
  const every = Math.max(1, Math.ceil(n / 7));
  const xLabelIdx = points.map((_, i) => i).filter((i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.6));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const last = points[n - 1];
  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover) - 80, 0), Math.max(width - 170, 0)) : 0;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${seriesName} over time`} style={{ display: 'block', overflow: 'visible' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.textMuted} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {format(t)}
              </text>
            </g>
          ))}
          {xLabelIdx.map((i) => (
            <text key={points[i].key} x={x(i)} y={height - 8} textAnchor={i === n - 1 && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle'} fontSize={11} fill={CHART.textMuted}>
              {points[i].label}
            </text>
          ))}

          <path d={area} fill={CHART.seriesWash} />
          <path d={line} fill="none" stroke={CHART.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {last && hover === null && (
            <g>
              <circle cx={x(n - 1)} cy={y(last.value)} r={4} fill={CHART.series} stroke={CHART.surface} strokeWidth={2} />
              <text x={x(n - 1) - 6} y={y(last.value) - 10} textAnchor="end" fontSize={12} fontWeight={600} fill={CHART.textPrimary}>
                {format(last.value)}
                {lastSuffix && <tspan fontWeight={400} fill={CHART.textSecondary}>{lastSuffix}</tspan>}
              </text>
            </g>
          )}

          {hp && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={CHART.axis} strokeWidth={1} />
              <circle cx={x(hover)} cy={y(hp.value)} r={4} fill={CHART.series} stroke={CHART.surface} strokeWidth={2} />
            </g>
          )}

          <rect
            x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {hp && (
        <div
          role="status"
          style={{
            position: 'absolute', top: 0, left: tipLeft, width: 170, pointerEvents: 'none',
            background: CHART.surface, border: '1px solid rgba(11,11,11,0.10)', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: '8px 10px', fontSize: 12,
          }}
        >
          <div style={{ color: CHART.textSecondary, marginBottom: 4 }}>{hp.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 2, background: CHART.series, borderRadius: 1 }} />
            <strong style={{ color: CHART.textPrimary, fontSize: 14 }}>{format(hp.value)}</strong>
            <span style={{ color: CHART.textSecondary }}>{seriesName}</span>
          </div>
          {hp.detail && <div style={{ color: CHART.textSecondary, marginTop: 2 }}>{hp.detail}</div>}
        </div>
      )}
    </div>
  );
}
