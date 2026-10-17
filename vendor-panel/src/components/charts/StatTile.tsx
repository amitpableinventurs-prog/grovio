import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { CHART } from './chartKit';

interface Props {
  label: string;
  value: string;
  current: number;
  previous: number;
  // Whether a rise is good news (orders) or bad news (cancellations).
  upIsGood?: boolean;
  periodName: string; // e.g. "previous 30 days"
  trend?: number[]; // sparkline values, oldest first
  hero?: boolean;
  suffix?: string; // small text after the value, e.g. "4.2% of orders"
}

function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={CHART.deEmphasis} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r={3} fill={CHART.series} stroke={CHART.surface} strokeWidth={1.5} />
    </svg>
  );
}

// Stat tile: label · value · signed delta vs the previous period (colour = direction × good/bad,
// always with an arrow and text, never colour alone) · optional sparkline.
export default function StatTile({ label, value, current, previous, upIsGood = true, periodName, trend, hero, suffix }: Props) {
  const change = previous ? ((current - previous) / previous) * 100 : current ? null : 0;
  const up = current > previous;
  const flat = current === previous;
  const good = flat ? null : up === upIsGood;
  const deltaColor = good === null ? CHART.textSecondary : good ? CHART.good : CHART.bad;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
      <div style={{ color: CHART.textSecondary, fontSize: 13 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ color: CHART.textPrimary, fontSize: hero ? 48 : 26, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
          {suffix && <div style={{ color: CHART.textMuted, fontSize: 12, marginTop: 2 }}>{suffix}</div>}
        </div>
        {trend && <Sparkline values={trend} width={hero ? 160 : 96} height={hero ? 44 : 28} />}
      </div>
      <div style={{ fontSize: 12, color: deltaColor, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 4px', marginTop: 'auto' }}>
        {!flat && (up ? <ArrowUpOutlined /> : <ArrowDownOutlined />)}
        <span style={{ whiteSpace: 'nowrap' }}>
          {flat ? 'No change' : change === null ? 'New' : `${up ? '+' : '−'}${Math.abs(change).toFixed(change !== null && Math.abs(change) < 10 ? 1 : 0)}%`}
        </span>
        <span style={{ color: CHART.textMuted, whiteSpace: 'nowrap' }}>vs {periodName}</span>
      </div>
    </div>
  );
}
