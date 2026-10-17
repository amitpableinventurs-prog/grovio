import { CHART } from './chartKit';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  valueText: string; // shown at the bar tip
  detail?: string; // muted text under the label
  color?: string; // defaults to the series hue (use the ordinal ramp for ordered stages)
}

// Horizontal bars with the label above and the value at the tip — every value is labelled, so no
// tooltip is needed. Bars are ≤ 10px thick with a rounded data end and grow from a shared baseline.
export default function BarList({ rows, emptyText = 'No data for this period' }: { rows: BarRow[]; emptyText?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || max === 0) {
    return <div style={{ color: CHART.textMuted, fontSize: 13, padding: '24px 0', textAlign: 'center' }}>{emptyText}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => (
        <div key={r.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: CHART.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
              {r.label}
              {r.detail && <span style={{ color: CHART.textMuted, marginLeft: 6 }}>{r.detail}</span>}
            </span>
            <span style={{ color: CHART.textPrimary, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.valueText}</span>
          </div>
          <div style={{ height: 10, borderRadius: '0 4px 4px 0', background: 'transparent', borderLeft: `1px solid ${CHART.axis}` }}>
            <div
              style={{
                width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%`,
                height: '100%',
                background: r.color || CHART.series,
                borderRadius: '0 4px 4px 0',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
