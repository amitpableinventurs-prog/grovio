import { Tag } from 'antd';
import { titleCase } from '../utils/format';

const COLOR_MAP: Record<string, string> = {
  pending: 'gold',
  success: 'green',
  approved: 'green',
  active: 'green',
  open: 'green',
  paid: 'green',
  delivered: 'green',
  processed: 'green',
  resolved: 'green',
  rejected: 'red',
  blocked: 'red',
  inactive: 'default',
  cancelled: 'red',
  failed: 'red',
  delivery_failed: 'red',
  returned: 'volcano',
  refunded: 'purple',
  in_progress: 'blue',
  closed: 'default',
  placed: 'blue',
  accepted: 'cyan',
  picking: 'blue',
  partially_picked: 'gold',
  packed: 'geekblue',
  assigned: 'purple',
  picked_up: 'lime',
  out_for_delivery: 'orange',
  completed: 'green',
};

export default function StatusTag({ status }: { status: string }) {
  return <Tag color={COLOR_MAP[status] || 'default'}>{titleCase(status)}</Tag>;
}
