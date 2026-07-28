import { CheckoutButton } from '@giwapay/react';

export default function StorePage() {
  const paymentIntentId = process.env.NEXT_PUBLIC_GIWAPAY_INTENT_ID;
  const checkoutBaseUrl = process.env.NEXT_PUBLIC_GIWAPAY_CHECKOUT_URL;

  return (
    <main>
      <p className="label">Testnet demo store</p>
      <div className="product">
        <div className="art" aria-hidden="true">
          <span />
        </div>
        <section>
          <p className="maker">NAMU OBJECTS · DIGITAL EDITION</p>
          <h1>Field Notes for Better Interfaces</h1>
          <p className="description">
            A compact digital workbook for prototyping calm, usable product surfaces. This sample
            uses mock tokens on GIWA Sepolia only.
          </p>
          <div className="price">
            <strong>Settlement amount comes from the PaymentIntent</strong>
            <small>No client-side amount is trusted</small>
          </div>
          {paymentIntentId && checkoutBaseUrl ? (
            <CheckoutButton paymentIntentId={paymentIntentId} checkoutBaseUrl={checkoutBaseUrl}>
              Continue to secure checkout
            </CheckoutButton>
          ) : (
            <p className="configuration">
              Configure NEXT_PUBLIC_GIWAPAY_INTENT_ID and NEXT_PUBLIC_GIWAPAY_CHECKOUT_URL with an
              API-created testnet PaymentIntent to enable checkout.
            </p>
          )}
          <p className="footnote">
            GiwaPay verifies settlement onchain before the merchant fulfills an order.
          </p>
        </section>
      </div>
    </main>
  );
}
