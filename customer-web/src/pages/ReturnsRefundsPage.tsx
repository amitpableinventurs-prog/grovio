import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';

interface Section {
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: '1. Order Cancellation',
    body: (
      <>
        <p>
          You can cancel an order yourself from <Link to="/orders" className="font-medium text-brand-700 hover:underline">My Orders</Link> at
          any point before it leaves the store for delivery — that is, while it&apos;s Placed, Accepted, Picking, Packed, or Assigned to a delivery
          partner.
        </p>
        <p className="mt-2">
          Once an order is marked <strong>Out for Delivery</strong>, it can no longer be cancelled from the app. If there&apos;s a genuine problem at
          that stage, please raise a ticket on our{' '}
          <Link to="/help" className="font-medium text-brand-700 hover:underline">
            Help &amp; Support
          </Link>{' '}
          page and our team will assist you.
        </p>
      </>
    ),
  },
  {
    title: '2. Because We Sell Groceries, Not Everything Is Returnable',
    body: (
      <p>
        Fresh produce, dairy, bakery items, and other perishables cannot be returned once delivered, for hygiene and food-safety reasons. This
        policy covers the situations below instead: items that never should have reached you in that condition in the first place.
      </p>
    ),
  },
  {
    title: '3. Missing, Damaged, or Wrong Items',
    body: (
      <>
        <p>If your delivery has a missing item, a damaged item, or the wrong item was sent, we will make it right. To report this:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Go to{' '}
            <Link to="/help" className="font-medium text-brand-700 hover:underline">
              Help &amp; Support
            </Link>{' '}
            and raise a ticket within <strong>24 hours</strong> of delivery.
          </li>
          <li>Mention your order number and describe the issue — a photo helps us resolve it faster.</li>
          <li>Our team reviews the ticket and issues a refund for the affected item(s), usually within 24–48 hours.</li>
        </ol>
      </>
    ),
  },
  {
    title: '4. How Refunds Are Paid',
    body: (
      <>
        <p>
          All refunds — whether from a cancelled order or a resolved support ticket — are credited to your{' '}
          <strong>Grovio Wallet</strong>, not back to your original payment method (card, UPI, netbanking, etc). Wallet credit shows up
          instantly and can be used toward payment on any future order.
        </p>
        <p className="mt-2">If you paid Cash on Delivery for a cancelled order, no refund is needed since no payment was collected.</p>
      </>
    ),
  },
  {
    title: '5. Order Not Delivered',
    body: (
      <p>
        If a delivery attempt fails and your order is marked <strong>Delivery Failed</strong>, our team will follow up with you to
        reschedule or refund it, depending on the reason. You don&apos;t need to raise a ticket for this — we reach out proactively.
      </p>
    ),
  },
];

export default function ReturnsRefundsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <RotateCcw size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Returns &amp; Refunds</h1>
          <p className="text-sm text-gray-500">Last updated: January 2026</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-6">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="mb-1.5 text-sm font-semibold text-gray-900">{section.title}</h2>
            <div className="text-sm leading-relaxed text-gray-500">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
