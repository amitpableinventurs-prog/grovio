import { useState, type ReactNode } from 'react';
import { Button, Card, Table } from 'antd';
import { TableOutlined, BarChartOutlined } from '@ant-design/icons';
import { CHART } from './chartKit';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  // Table view twin of the chart (accessibility / exact values).
  table?: { columns: { title: string; dataIndex: string; align?: 'left' | 'right' }[]; rows: Record<string, string | number>[] };
  extra?: ReactNode;
  dimmed?: boolean; // refetching: hold the previous render at reduced opacity
}

export default function ChartCard({ title, subtitle, children, table, extra, dimmed }: Props) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      style={{ height: '100%' }}
      styles={{ body: { paddingTop: 12 } }}
      title={
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: CHART.textPrimary }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, fontWeight: 400, color: CHART.textMuted }}>{subtitle}</div>}
        </div>
      }
      extra={
        <>
          {extra}
          {table && (
            <Button
              type="text" size="small"
              icon={asTable ? <BarChartOutlined /> : <TableOutlined />}
              onClick={() => setAsTable((v) => !v)}
              aria-label={asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
            >
              {asTable ? 'Chart' : 'Table'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 0.2s' }}>
        {asTable && table ? (
          <Table
            size="small"
            pagination={false}
            scroll={{ y: 260 }}
            rowKey={(r) => String(Object.values(r)[0])}
            dataSource={table.rows}
            columns={table.columns.map((c) => ({ ...c, key: c.dataIndex }))}
          />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
