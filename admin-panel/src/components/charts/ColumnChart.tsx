import { useState } from 'react';
import { CHART, niceTicks, roundedTopBar, useElementWidth } from './chartKit';

export interface Column {
  key: string;
  label: string; // axis label (may be blank to skip)
  tooltipLabel: string;
  value: number;
}

interface Props {
  columns: Column[];
  height?: number;
  format: (n: number) => string;
  unit: string;
  // Index of a column to call out (e.g. the busiest hour) with a value label.
  highlight?: number | null;
}

const PAD = { top: 20, right: 8, bottom: 26, left: 36 };

// Vertical columns (≤ 24px, rounded top, square base) with a per-column hover tooltip.
export default function ColumnChart({ columns, height = 220, format, unit, highlight = null }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = height - PAD.top - PAD.bottom;
  const ticks = niceTicks(Math.max(...columns.map((c) => c.value), 0), 3);
  const top = ticks[ticks.length - 1];
  const band = plotW / Math.max(columns.length, 1);
  const barW = Math.min(24, Math.max(band - 2, 2)); // 2px surface gap minimum between bars
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const hc = hover !== null ? columns[hover] : null;
  const tipX = hover !== null ? PAD.left + band * hover + band / 2 : 0;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Columns: ${unit}`} style={{ display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.textMuted} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {format(t)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const bx = PAD.left + band * i + (band - barW) / 2;
            const by = y(c.value);
            const active = hover === i;
            return (
              <g key={c.key}>
                <path d={roundedTopBar(bx, by, barW, PAD.top + plotH - by)} fill={CHART.series} opacity={hover === null || active ? 1 : 0.55} />
                {c.label && (
                  <text x={PAD.left + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={CHART.textMuted}>
                    {c.label}
                  </text>
                )}
                {highlight === i && c.value > 0 && hover === null && (
                  <text x={PAD.left + band * i + band / 2} y={by - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={CHART.textPrimary}>
                    {format(c.value)}
                  </text>
                )}
                {/* Hit target: the whole band, taller than the bar */}
                <rect
                  x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent"
                  tabIndex={0} aria-label={`${c.tooltipLabel}: ${format(c.value)} ${unit}`}
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hc && (
        <div
          role="status"
          style={{
            position: 'absolute', top: 0, left: Math.min(Math.max(tipX - 60, 0), Math.max(width - 130, 0)), width: 130, pointerEvents: 'none',
            background: CHART.surface, border: '1px solid rgba(11,11,11,0.10)', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: '6px 10px', fontSize: 12,
          }}
        >
          <div style={{ color: CHART.textSecondary }}>{hc.tooltipLabel}</div>
          <strong style={{ color: CHART.textPrimary, fontSize: 14 }}>{format(hc.value)}</strong>{' '}
          <span style={{ color: CHART.textSecondary }}>{unit}</span>
        </div>
      )}
    </div>
  );
}
