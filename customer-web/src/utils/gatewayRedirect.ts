import * as paymentsApi from '../api/payments';
import type { PaymentMethod } from '../types';

// PayU takes the customer via a form POST to its hosted page — build that form and submit it.
function submitHostedForm(action: string, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

// Sends the customer to the PayU / PhonePe payment page for an already-placed order. Both bring
// them back to /payment/return afterwards (PaymentReturnPage).
export async function redirectToGateway(method: Extract<PaymentMethod, 'PAYU' | 'PHONEPE'>, orderId: string) {
  if (method === 'PAYU') {
    const { action, fields } = await paymentsApi.createPayuPayment(orderId);
    submitHostedForm(action, fields);
    return;
  }
  const { redirectUrl } = await paymentsApi.createPhonepePayment(orderId);
  window.location.assign(redirectUrl);
}
