import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Mail, MessageCircle, Phone } from 'lucide-react';
import { createTicket, listMyTickets, type SupportTicket } from '../api/support';
import { apiErrorMessage } from '../api/client';
import Loader from '../components/Loader';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I track my order?',
    a: 'Open My Orders and tap the order — you\'ll see its live status (Placed, Accepted, Picking, Packed, Out for Delivery, Delivered) and the assigned delivery partner once one is on the way.',
  },
  {
    q: 'How do I cancel an order?',
    a: 'You can cancel from the order detail page any time before it\'s out for delivery. Once a delivery partner has picked it up, it can no longer be cancelled from the app — contact support instead.',
  },
  {
    q: 'I cancelled a paid order — where\'s my money?',
    a: 'It\'s credited back instantly to your Grovio Wallet (Profile → Wallet), not to your original payment method. Wallet balance can be used on any future order.',
  },
  {
    q: 'What is the delivery PIN?',
    a: 'Once a delivery partner is assigned, a 4-digit PIN appears on your order tracking screen. Share it with the delivery partner at your doorstep to confirm the handover — this protects you from wrong deliveries.',
  },
  {
    q: 'What payment methods are accepted?',
    a: 'Cash on Delivery, online payment via Razorpay (cards, UPI, netbanking, wallets), and your Grovio Wallet balance.',
  },
  {
    q: 'An item was missing, damaged, or wrong in my delivery.',
    a: 'Raise a ticket below with your order number and what went wrong. See our Returns & Refunds page for how these cases are resolved.',
  },
];

function TicketStatusBadge({ status }: { status: SupportTicket['status'] }) {
  const styles: Record<SupportTicket['status'], string> = {
    open: 'bg-blue-50 text-blue-600',
    in_progress: 'bg-amber-50 text-amber-600',
    resolved: 'bg-brand-50 text-brand-700',
    closed: 'bg-gray-100 text-gray-600',
  };
  const labels: Record<SupportTicket['status'], string> = {
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
  };
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

export default function HelpSupportPage() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: tickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => listMyTickets(),
  });

  const submitMutation = useMutation({
    mutationFn: () => createTicket(subject.trim(), message.trim()),
    onSuccess: () => {
      setSubject('');
      setMessage('');
      setError(null);
      setSuccess('Your ticket has been submitted. Our team usually replies within 24 hours.');
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not submit your ticket. Please try again.')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(null);
    if (!subject.trim() || !message.trim()) {
      setError('Please fill in both the subject and your message.');
      return;
    }
    submitMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <LifeBuoy size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Help &amp; Support</h1>
          <p className="text-sm text-gray-500">Answers to common questions, and a direct line to our team.</p>
        </div>
      </div>

      {/* Quick contact */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <a href="tel:18001234567" className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <Phone size={18} className="text-brand-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Call us</p>
            <p className="text-xs text-gray-500">1800-123-4567</p>
          </div>
        </a>
        <a href="mailto:support@grovio.com" className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <Mail size={18} className="text-brand-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Email us</p>
            <p className="text-xs text-gray-500">support@grovio.com</p>
          </div>
        </a>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <MessageCircle size={18} className="text-brand-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Raise a ticket</p>
            <p className="text-xs text-gray-500">Use the form below</p>
          </div>
        </div>
      </div>

      {/* FAQs */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Frequently Asked Questions</h2>
        <div className="flex flex-col divide-y divide-gray-100">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group py-3 first:pt-0 last:pb-0">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-gray-800">
                {faq.q}
                <span className="ml-3 shrink-0 text-gray-400 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{faq.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Didn&apos;t find what you need? See our{' '}
          <Link to="/returns-refunds" className="font-medium text-brand-700 hover:underline">
            Returns &amp; Refunds
          </Link>{' '}
          page, or raise a ticket below.
        </p>
      </div>

      {/* Raise a ticket */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Raise a Support Ticket</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-700">
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Missing item in order #GRV1234"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe your issue — include your order number if it relates to an order."
              className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-brand-700">{success}</p>}

          <button
            type="submit"
            disabled={submitMutation.isPending}
            className="mt-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {submitMutation.isPending ? 'Submitting...' : 'Submit Ticket'}
          </button>
        </form>
      </div>

      {/* My tickets */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-gray-900">My Tickets</h2>
        {ticketsLoading ? (
          <Loader label="Loading your tickets..." />
        ) : !tickets || tickets.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">You haven&apos;t raised any tickets yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {tickets.items.map((ticket) => (
              <div key={ticket._id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{ticket.subject}</p>
                  <TicketStatusBadge status={ticket.status} />
                </div>
                <p className="mt-1 text-sm text-gray-500">{ticket.message}</p>
                <p className="mt-1 text-xs text-gray-400">{new Date(ticket.createdAt).toLocaleString()}</p>
                {ticket.adminReply && (
                  <div className="mt-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
                    <span className="font-semibold">Grovio Support: </span>
                    {ticket.adminReply}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
