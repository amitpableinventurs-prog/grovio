import { Info } from 'lucide-react';

interface Section {
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: 'Who We Are',
    body: (
      <p>
        Grovio is a quick-commerce grocery platform built to get fresh fruits, vegetables, dairy, and everyday household essentials to your
        doorstep in minutes, not hours. We partner with local dark stores across your city so your order comes from a store near you, packed
        by a real person and delivered by a real person — not a warehouse three states away.
      </p>
    ),
  },
  {
    title: 'Our Mission',
    body: (
      <p>
        We believe grocery shopping shouldn't eat into your day. Our mission is simple: make it effortless to get what you need, when you
        need it, at a fair price — without compromising on freshness or service.
      </p>
    ),
  },
  {
    title: 'How Grovio Works',
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>You browse products from your nearest Grovio store and place an order.</li>
        <li>The store accepts your order and a picker gets to work picking and packing it.</li>
        <li>A delivery partner collects the packed order and heads your way.</li>
        <li>You confirm delivery with a one-time PIN shown right in the app — simple, and secure.</li>
      </ul>
    ),
  },
  {
    title: 'Why Choose Grovio',
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Fast delivery, sourced from a store close to you.</li>
        <li>Fresh produce and everyday essentials, checked before packing.</li>
        <li>Transparent pricing with no hidden charges at checkout.</li>
        <li>Secure payments — Cash on Delivery, UPI, cards, and netbanking.</li>
        <li>Real-time order tracking from picking to delivery.</li>
      </ul>
    ),
  },
  {
    title: 'Get in Touch',
    body: (
      <p>
        Have a question, feedback, or a partnership idea? We'd love to hear from you at{' '}
        <a href="mailto:support@grovio.com" className="font-medium text-brand-700 hover:underline">
          support@grovio.com
        </a>{' '}
        or raise a ticket via Help &amp; Support.
      </p>
    ),
  },
];

export default function AboutUsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Info size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">About Us</h1>
          <p className="text-sm text-gray-500">Quick groceries, delivered fast</p>
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
