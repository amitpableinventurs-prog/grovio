import { FileText } from 'lucide-react';

interface Section {
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: '1. Acceptance of Terms',
    body: (
      <p>
        By creating a Grovio account or placing an order through our app or website, you agree to be bound by these Terms &amp; Conditions.
        If you do not agree with any part of these terms, please do not use the Grovio service.
      </p>
    ),
  },
  {
    title: '2. Who Can Use Grovio',
    body: (
      <p>
        Grovio is available to individuals who can form a legally binding contract under applicable law and who provide accurate registration
        details. You are responsible for maintaining the confidentiality of your account and for all activity under it, including the OTP
        sent to your registered mobile number.
      </p>
    ),
  },
  {
    title: '3. Orders and Availability',
    body: (
      <>
        <p>
          All products listed on Grovio are subject to availability at the fulfilling store. We reserve the right to limit quantities, refuse
          or cancel any order — including after payment — if a product turns out to be unavailable, mispriced, or if we suspect fraudulent or
          abusive activity.
        </p>
        <p className="mt-2">
          If we cancel an order you have already paid for, the amount is credited to your Grovio Wallet. See our{' '}
          <a href="/returns-refunds" className="font-medium text-brand-700 hover:underline">
            Returns &amp; Refunds
          </a>{' '}
          policy for details.
        </p>
      </>
    ),
  },
  {
    title: '4. Pricing and Payment',
    body: (
      <p>
        Prices shown at checkout are final and include all applicable taxes and delivery fees unless stated otherwise. We accept Cash on
        Delivery, online payment via Razorpay (cards, UPI, netbanking, and wallets), and your Grovio Wallet balance. By choosing an online
        payment method, you authorize us and our payment partner to process the transaction.
      </p>
    ),
  },
  {
    title: '5. Delivery',
    body: (
      <p>
        Delivery timelines shown in the app are estimates, not guarantees, and can be affected by weather, traffic, or store readiness. A
        one-time PIN is generated once a delivery partner is assigned to your order — you must share this PIN with the delivery partner to
        confirm receipt of your order. Do not share it before the delivery partner has arrived with your items.
      </p>
    ),
  },
  {
    title: '6. Grovio Wallet',
    body: (
      <p>
        The Grovio Wallet is a store-of-value feature used to hold refunds and credits within your account. Wallet balance has no cash
        withdrawal value, cannot be transferred to another user, and can only be redeemed against future Grovio orders.
      </p>
    ),
  },
  {
    title: '7. User Conduct',
    body: (
      <p>
        You agree not to misuse the platform — including placing fraudulent orders, abusing promotional coupons, providing false delivery
        addresses, or being abusive toward our pickers or delivery partners. We reserve the right to suspend or terminate accounts that
        violate these terms.
      </p>
    ),
  },
  {
    title: '8. Reviews and Content',
    body: (
      <p>
        Any product ratings or reviews you submit must be honest, based on genuine experience, and free of offensive or unlawful content. We
        may remove content that violates this at our discretion.
      </p>
    ),
  },
  {
    title: '9. Limitation of Liability',
    body: (
      <p>
        Grovio is provided on an &quot;as is&quot; basis. To the maximum extent permitted by law, we are not liable for indirect or
        consequential losses arising from delays, stock unavailability, or service interruptions. Our total liability for any claim is
        limited to the value of the order giving rise to that claim.
      </p>
    ),
  },
  {
    title: '10. Changes to These Terms',
    body: (
      <p>
        We may update these Terms &amp; Conditions from time to time to reflect changes in our service or legal requirements. Continued use
        of Grovio after an update constitutes acceptance of the revised terms.
      </p>
    ),
  },
  {
    title: '11. Contact Us',
    body: (
      <p>
        Questions about these terms can be sent to <a href="mailto:support@grovio.com" className="font-medium text-brand-700 hover:underline">support@grovio.com</a> or
        raised via our Help &amp; Support page.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <FileText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Terms &amp; Conditions</h1>
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
