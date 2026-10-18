// Pure business logic: fees, profit, stats, CSV. No DOM access so it can be unit tested in Node.

export const STATUSES = ['sourced', 'listed', 'sold'];

export const CATEGORIES = [
  'Tops', 'Outerwear', 'Bottoms', 'Dresses', 'Denim', 'Band & Graphic Tees',
  'Sportswear', 'Shoes', 'Bags', 'Accessories', 'Jewelry', 'Home & Decor', 'Other',
];

export const ERAS = ['Pre-1950s', '1950s', '1960s', '1970s', '1980s', '1990s', 'Y2K', '2010s+', 'Unknown'];

export const CONDITIONS = ['Deadstock / NWT', 'Excellent', 'Very Good', 'Good', 'Fair', 'Flawed / As-Is'];

// Default fee schedules. These are estimates of each marketplace's published fees and change
// often, so every value is editable in Settings.
//   percent: share of (sale price + shipping charged) taken by the platform
//   fixed:   flat per-order fee
//   smallOrderThreshold / smallOrderFlat: flat fee replacing the percent below a sale price
export const DEFAULT_PLATFORMS = {
  ebay: { name: 'eBay', percent: 13.25, fixed: 0.4 },
  etsy: { name: 'Etsy', percent: 9.5, fixed: 0.45 },
  depop: { name: 'Depop', percent: 3.3, fixed: 0.45 },
  poshmark: { name: 'Poshmark', percent: 20, fixed: 0, smallOrderThreshold: 15, smallOrderFlat: 2.95 },
  grailed: { name: 'Grailed', percent: 12.49, fixed: 0.49 },
  mercari: { name: 'Mercari', percent: 10, fixed: 0.5 },
  instore: { name: 'In person / Booth', percent: 0, fixed: 0 },
};

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function platformFee(platform, salePrice, shippingCharged = 0) {
  if (!platform) return 0;
  const price = num(salePrice);
  if (price <= 0) return 0;
  if (platform.smallOrderThreshold && price < platform.smallOrderThreshold) {
    return round2(num(platform.smallOrderFlat));
  }
  const base = price + num(shippingCharged);
  return round2(base * (num(platform.percent) / 100) + num(platform.fixed));
}

// Net profit for a sold item. Fees default to the platform estimate unless an explicit fee was recorded.
export function profitFor(item, platforms = DEFAULT_PLATFORMS) {
  const sale = item.sale || {};
  const price = num(sale.price);
  const shippingCharged = num(sale.shippingCharged);
  const fees = sale.fees !== undefined && sale.fees !== '' && sale.fees !== null
    ? num(sale.fees)
    : platformFee(platforms[sale.platform], price, shippingCharged);
  const revenue = price + shippingCharged;
  const costs = num(item.cost) + fees + num(sale.shippingCost) + num(sale.otherCosts);
  const profit = round2(revenue - costs);
  const roi = num(item.cost) > 0 ? round2((profit / num(item.cost)) * 100) : null;
  const margin = revenue > 0 ? round2((profit / revenue) * 100) : null;
  return { revenue: round2(revenue), fees: round2(fees), costs: round2(costs), profit, roi, margin };
}

// Suggests a list price that clears the target profit after estimated fees and shipping.
export function suggestPrice({ cost, targetProfit = 0, shippingCost = 0, shippingCharged = 0, platform }) {
  const pct = platform ? num(platform.percent) / 100 : 0;
  const fixed = platform ? num(platform.fixed) : 0;
  const needed = num(cost) + num(targetProfit) + num(shippingCost) + fixed - num(shippingCharged) * (1 - pct);
  if (pct >= 1) return null;
  let price = Math.max(0, needed / (1 - pct));
  if (platform && platform.smallOrderThreshold && price < platform.smallOrderThreshold) {
    const flatPrice = num(cost) + num(targetProfit) + num(shippingCost) + num(platform.smallOrderFlat) - num(shippingCharged);
    if (flatPrice < platform.smallOrderThreshold) price = Math.max(0, flatPrice);
    else price = platform.smallOrderThreshold;
  }
  return round2(price);
}

export function daysBetween(fromIso, toIso = new Date().toISOString()) {
  if (!fromIso) return null;
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

export function daysInInventory(item, now) {
  const end = item.status === 'sold' && item.sale && item.sale.date ? item.sale.date : now;
  return daysBetween(item.acquiredDate, end);
}

function monthKey(iso) {
  return iso ? iso.slice(0, 7) : null;
}

export function computeStats(items, platforms = DEFAULT_PLATFORMS, { now, staleDays = 90 } = {}) {
  const sold = items.filter((i) => i.status === 'sold');
  const unsold = items.filter((i) => i.status !== 'sold');
  let revenue = 0;
  let profit = 0;
  let fees = 0;
  let soldCost = 0;
  let sellDaysTotal = 0;
  let sellDaysCount = 0;
  const byMonth = {};
  const byPlatform = {};
  const byCategory = {};

  for (const item of sold) {
    const p = profitFor(item, platforms);
    revenue += p.revenue;
    profit += p.profit;
    fees += p.fees;
    soldCost += num(item.cost);
    const d = daysInInventory(item, now);
    if (d !== null) {
      sellDaysTotal += d;
      sellDaysCount += 1;
    }
    const m = monthKey(item.sale && item.sale.date);
    if (m) {
      byMonth[m] = byMonth[m] || { revenue: 0, profit: 0, count: 0 };
      byMonth[m].revenue += p.revenue;
      byMonth[m].profit += p.profit;
      byMonth[m].count += 1;
    }
    const plat = (item.sale && item.sale.platform) || 'other';
    byPlatform[plat] = byPlatform[plat] || { revenue: 0, profit: 0, count: 0 };
    byPlatform[plat].revenue += p.revenue;
    byPlatform[plat].profit += p.profit;
    byPlatform[plat].count += 1;
    const cat = item.category || 'Other';
    byCategory[cat] = byCategory[cat] || { revenue: 0, profit: 0, count: 0 };
    byCategory[cat].revenue += p.revenue;
    byCategory[cat].profit += p.profit;
    byCategory[cat].count += 1;
  }

  const inventoryCost = unsold.reduce((s, i) => s + num(i.cost), 0);
  const inventoryValue = unsold.reduce((s, i) => s + num(i.listPrice), 0);
  const stale = unsold
    .filter((i) => (daysInInventory(i, now) ?? 0) >= staleDays)
    .sort((a, b) => (daysInInventory(b, now) ?? 0) - (daysInInventory(a, now) ?? 0));

  const roundAll = (obj) => {
    for (const k of Object.keys(obj)) {
      obj[k].revenue = round2(obj[k].revenue);
      obj[k].profit = round2(obj[k].profit);
    }
    return obj;
  };

  return {
    totalItems: items.length,
    counts: {
      sourced: items.filter((i) => i.status === 'sourced').length,
      listed: items.filter((i) => i.status === 'listed').length,
      sold: sold.length,
    },
    revenue: round2(revenue),
    profit: round2(profit),
    fees: round2(fees),
    soldCost: round2(soldCost),
    roi: soldCost > 0 ? round2((profit / soldCost) * 100) : null,
    avgProfit: sold.length ? round2(profit / sold.length) : 0,
    avgDaysToSell: sellDaysCount ? Math.round(sellDaysTotal / sellDaysCount) : null,
    sellThrough: items.length ? round2((sold.length / items.length) * 100) : 0,
    inventoryCost: round2(inventoryCost),
    inventoryValue: round2(inventoryValue),
    stale,
    byMonth: roundAll(byMonth),
    byPlatform: roundAll(byPlatform),
    byCategory: roundAll(byCategory),
  };
}

export function nextSku(items, prefix = 'VTG') {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const i of items) {
    const m = re.exec(i.sku || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// Builds a marketplace-ready title and description from item fields.
export function generateListing(item) {
  const titleParts = [
    'Vintage',
    item.era && item.era !== 'Unknown' ? item.era : '',
    item.brand,
    item.title,
    item.size ? `Size ${item.size}` : '',
  ].filter(Boolean);
  const seen = new Set();
  const title = titleParts
    .join(' ')
    .split(/\s+/)
    .filter((w) => {
      const k = w.toLowerCase();
      if (k === 'vintage' && seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(' ')
    .slice(0, 80);

  const lines = [title, ''];
  if (item.description) lines.push(item.description, '');
  const details = [
    ['Brand', item.brand],
    ['Era', item.era],
    ['Size (tag)', item.size],
    ['Measurements', item.measurements],
    ['Material', item.material],
    ['Color', item.color],
    ['Condition', item.condition],
  ].filter(([, v]) => v);
  for (const [k, v] of details) lines.push(`${k}: ${v}`);
  if (item.flaws) lines.push('', `Flaws: ${item.flaws}`);
  lines.push('', 'All items are pre-owned vintage and may show normal signs of wear. Please review photos and measurements before purchasing.');
  const tags = [item.era, item.brand, item.category, item.color, 'vintage']
    .filter(Boolean)
    .map((t) => `#${String(t).toLowerCase().replace(/[^a-z0-9]/g, '')}`)
    .filter((t) => t.length > 1);
  lines.push('', [...new Set(tags)].join(' '));
  return { title, description: lines.join('\n') };
}

export const CSV_COLUMNS = [
  'sku', 'title', 'brand', 'category', 'era', 'size', 'condition', 'color', 'material', 'measurements',
  'flaws', 'description', 'cost', 'source', 'acquiredDate', 'listPrice', 'listedOn', 'location', 'status',
  'salePlatform', 'salePrice', 'saleDate', 'shippingCharged', 'shippingCost', 'fees', 'otherCosts', 'profit',
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items, platforms = DEFAULT_PLATFORMS) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const i of items) {
    const s = i.sale || {};
    const row = {
      ...i,
      listedOn: (i.listedOn || []).join('|'),
      salePlatform: s.platform,
      salePrice: s.price,
      saleDate: s.date,
      shippingCharged: s.shippingCharged,
      shippingCost: s.shippingCost,
      fees: i.status === 'sold' ? profitFor(i, platforms).fees : '',
      otherCosts: s.otherCosts,
      profit: i.status === 'sold' ? profitFor(i, platforms).profit : '',
    };
    rows.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  }
  return rows.join('\n');
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function itemsFromCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const get = (r, k) => (idx[k] !== undefined ? (r[idx[k]] ?? '').trim() : '');
  return rows.map((r) => {
    const status = STATUSES.includes(get(r, 'status')) ? get(r, 'status') : 'sourced';
    const item = {
      sku: get(r, 'sku'), title: get(r, 'title'), brand: get(r, 'brand'), category: get(r, 'category'),
      era: get(r, 'era'), size: get(r, 'size'), condition: get(r, 'condition'), color: get(r, 'color'),
      material: get(r, 'material'), measurements: get(r, 'measurements'), flaws: get(r, 'flaws'),
      description: get(r, 'description'), cost: num(get(r, 'cost')), source: get(r, 'source'),
      acquiredDate: get(r, 'acquiredDate'), listPrice: num(get(r, 'listPrice')),
      listedOn: get(r, 'listedOn') ? get(r, 'listedOn').split('|').filter(Boolean) : [],
      location: get(r, 'location'), status,
    };
    if (status === 'sold') {
      item.sale = {
        platform: get(r, 'salePlatform'), price: num(get(r, 'salePrice')), date: get(r, 'saleDate'),
        shippingCharged: num(get(r, 'shippingCharged')), shippingCost: num(get(r, 'shippingCost')),
        fees: get(r, 'fees') === '' ? undefined : num(get(r, 'fees')), otherCosts: num(get(r, 'otherCosts')),
      };
    }
    return item;
  });
}
