import { formatPrice } from '../utils/format';

// The charge lines of a bill, shared by checkout (before ordering) and order detail (after).
// Charges are set by the admin and applied once per order — see backend services/charges.service.js.
// A charge of 0 is hidden, except delivery, which reads "Free" so the customer sees the saving.
export interface BillAmounts {
  itemTotal: number;
  deliveryFee: number;
  handlingCharge?: number;
  packingCharge?: number;
  surcharge?: number;
  surchargeLabel?: string | null;
  discount: number;
}

function Line({ label, amount, className = '' }: { label: string; amount: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <span>{label}</span>
      <span className="tabular-nums">{amount}</span>
    </div>
  );
}

export default function BillBreakdown({ bill }: { bill: BillAmounts }) {
  return (
    <>
      <Line label="Item Total" amount={formatPrice(bill.itemTotal)} />
      <Line
        label="Delivery Charge"
        amount={bill.deliveryFee > 0 ? formatPrice(bill.deliveryFee) : <span className="font-medium text-brand-700">Free</span>}
      />
      {!!bill.handlingCharge && <Line label="Handling Charge" amount={formatPrice(bill.handlingCharge)} />}
      {!!bill.packingCharge && <Line label="Packing Charge" amount={formatPrice(bill.packingCharge)} />}
      {!!bill.surcharge && <Line label={bill.surchargeLabel || 'Surcharge'} amount={formatPrice(bill.surcharge)} />}
      {bill.discount > 0 && <Line label="Discount" amount={`-${formatPrice(bill.discount)}`} className="text-brand-700" />}
    </>
  );
}
