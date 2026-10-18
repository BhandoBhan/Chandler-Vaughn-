import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLATFORMS, platformFee, profitFor, suggestPrice, computeStats, nextSku,
  generateListing, toCsv, itemsFromCsv, parseCsv, daysBetween,
} from '../js/calc.js';

const P = DEFAULT_PLATFORMS;

test('platformFee applies percent of price + shipping plus fixed fee', () => {
  assert.equal(platformFee({ percent: 10, fixed: 0.5 }, 100, 10), 11.5);
  assert.equal(platformFee({ percent: 10, fixed: 0.5 }, 0), 0);
  assert.equal(platformFee(undefined, 100), 0);
});

test('Poshmark-style flat fee below threshold', () => {
  assert.equal(platformFee(P.poshmark, 10), 2.95);
  assert.equal(platformFee(P.poshmark, 50), 10);
});

test('profitFor uses estimated fees unless explicit fees recorded', () => {
  const item = { cost: 10, sale: { platform: 'instore', price: 50, shippingCost: 0 } };
  assert.deepEqual(profitFor(item, P), { revenue: 50, fees: 0, costs: 10, profit: 40, roi: 400, margin: 80 });
  const withFees = { cost: 10, sale: { platform: 'ebay', price: 50, fees: 7, shippingCharged: 5, shippingCost: 6 } };
  const r = profitFor(withFees, P);
  assert.equal(r.fees, 7);
  assert.equal(r.profit, 55 - 10 - 7 - 6);
});

test('profitFor handles zero cost without dividing by zero', () => {
  const r = profitFor({ cost: 0, sale: { platform: 'instore', price: 20 } }, P);
  assert.equal(r.roi, null);
  assert.equal(r.profit, 20);
});

test('suggestPrice yields a price whose profit meets the target', () => {
  for (const key of ['ebay', 'etsy', 'depop', 'grailed', 'mercari']) {
    const args = { cost: 12, targetProfit: 25, shippingCost: 8, shippingCharged: 5, platform: P[key] };
    const price = suggestPrice(args);
    const { profit } = profitFor({ cost: 12, sale: { platform: key, price, shippingCharged: 5, shippingCost: 8 } }, P);
    assert.ok(Math.abs(profit - 25) <= 0.02, `${key}: profit ${profit} at ${price}`);
  }
});

test('suggestPrice uses Poshmark flat fee for small orders', () => {
  const price = suggestPrice({ cost: 2, targetProfit: 5, platform: P.poshmark });
  assert.equal(price, 9.95);
});

test('nextSku increments the highest existing number', () => {
  assert.equal(nextSku([], 'VTG'), 'VTG-0001');
  assert.equal(nextSku([{ sku: 'VTG-0009' }, { sku: 'VTG-0003' }, { sku: 'OTHER-99' }], 'VTG'), 'VTG-0010');
});

test('daysBetween', () => {
  assert.equal(daysBetween('2024-01-01', '2024-01-31'), 30);
  assert.equal(daysBetween('', '2024-01-31'), null);
});

test('computeStats aggregates sales, inventory, and stale items', () => {
  const now = '2024-06-30T00:00:00Z';
  const items = [
    { cost: 10, status: 'sold', category: 'Denim', acquiredDate: '2024-06-01', sale: { platform: 'instore', price: 40, date: '2024-06-11' } },
    { cost: 5, status: 'sold', category: 'Denim', acquiredDate: '2024-05-01', sale: { platform: 'instore', price: 25, date: '2024-05-21' } },
    { cost: 8, status: 'listed', listPrice: 50, acquiredDate: '2024-01-01' },
    { cost: 4, status: 'sourced', listPrice: 0, acquiredDate: '2024-06-20' },
  ];
  const s = computeStats(items, P, { now, staleDays: 90 });
  assert.equal(s.revenue, 65);
  assert.equal(s.profit, 50);
  assert.equal(s.roi, round(50 / 15 * 100));
  assert.equal(s.avgDaysToSell, 15);
  assert.equal(s.inventoryCost, 12);
  assert.equal(s.inventoryValue, 50);
  assert.equal(s.stale.length, 1);
  assert.equal(s.byMonth['2024-06'].profit, 30);
  assert.equal(s.byCategory.Denim.count, 2);
  assert.equal(s.sellThrough, 50);
});

function round(n) { return Math.round(n * 100) / 100; }

test('generateListing builds an 80-char max title without duplicate "Vintage"', () => {
  const { title, description } = generateListing({ title: 'Vintage Levi\'s 501', era: '1990s', brand: "Levi's", size: '32', condition: 'Good', flaws: 'small hole' });
  assert.ok(title.length <= 80);
  assert.equal(title.match(/vintage/gi).length, 1);
  assert.match(description, /Flaws: small hole/);
  assert.match(description, /#1990s/);
});

test('CSV round trip preserves fields including commas and quotes', () => {
  const items = [
    { sku: 'A-1', title: 'Tee, "rare"', cost: 5, listPrice: 30, listedOn: ['ebay', 'depop'], status: 'listed', acquiredDate: '2024-01-01' },
    { sku: 'A-2', title: 'Jeans\nwith newline', cost: 10, status: 'sold', sale: { platform: 'ebay', price: 60, date: '2024-02-01', shippingCost: 5 } },
  ];
  const back = itemsFromCsv(toCsv(items, P));
  assert.equal(back.length, 2);
  assert.equal(back[0].title, 'Tee, "rare"');
  assert.deepEqual(back[0].listedOn, ['ebay', 'depop']);
  assert.equal(back[1].title, 'Jeans\nwith newline');
  assert.equal(back[1].status, 'sold');
  assert.equal(back[1].sale.price, 60);
  assert.equal(back[1].sale.fees, platformFee(P.ebay, 60));
});

test('parseCsv handles CRLF and blank lines', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n\r\n'), [['a', 'b'], ['1', '2']]);
});
