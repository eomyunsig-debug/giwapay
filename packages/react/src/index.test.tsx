// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CheckoutButton } from './index.js';

describe('CheckoutButton', () => {
  it('creates an encoded hosted checkout link', () => {
    render(
      <CheckoutButton paymentIntentId="pi/order 1" checkoutBaseUrl="https://checkout.example/" />,
    );

    expect(screen.getByRole('link', { name: 'Pay with GiwaPay' })).toHaveAttribute(
      'href',
      'https://checkout.example/checkout/pi%2Forder%201',
    );
  });
});
