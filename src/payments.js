'use strict';

const crypto = require('node:crypto');

// The boundary between wallets and real money. The demo provider approves
// every deposit and withdrawal instantly with play money so the whole app can
// be tried end to end. To handle real money, add a provider here with the same
// two methods, backed by a licensed processor, and select it with PAYMENTS_MODE.
const providers = {
  demo: {
    name: 'demo',
    realMoney: false,
    async deposit() {
      return { reference: `demo-${crypto.randomUUID()}` };
    },
    async withdraw() {
      return { reference: `demo-${crypto.randomUUID()}` };
    },
  },
};

function createPaymentProvider(mode) {
  const provider = providers[mode];
  if (!provider) {
    throw new Error(`Unknown PAYMENTS_MODE "${mode}". Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
}

module.exports = { createPaymentProvider };
