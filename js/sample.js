// Demo inventory so new users can explore the app. Dates are relative to today.
import { uid } from './store.js';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const SAMPLES = [
  { title: '3D Emblem Harley-Davidson Tee', brand: 'Harley-Davidson', category: 'Band & Graphic Tees', era: '1990s', size: 'XL', condition: 'Very Good', color: 'Black', material: '100% cotton', measurements: 'P2P 24", length 30"', cost: 6, source: 'Goodwill Outlet', acquired: 70, listPrice: 85, listedOn: ['ebay', 'depop'], sold: { platform: 'ebay', price: 78, daysAgo: 40, shippingCharged: 0, shippingCost: 5.5 } },
  { title: 'Levi\'s 501 Made in USA', brand: "Levi's", category: 'Denim', era: '1990s', size: 'W32 L30', condition: 'Good', color: 'Medium wash', material: '100% cotton denim', measurements: 'Waist 32", inseam 29.5"', flaws: 'Small fray at hem', cost: 12, source: 'Estate sale', acquired: 120, listPrice: 95, listedOn: ['ebay', 'grailed'], sold: { platform: 'grailed', price: 88, daysAgo: 75, shippingCharged: 0, shippingCost: 9 } },
  { title: 'Carhartt Detroit Jacket Blanket Lined', brand: 'Carhartt', category: 'Outerwear', era: '1990s', size: 'L', condition: 'Good', color: 'Brown duck', cost: 25, source: 'Flea market', acquired: 50, listPrice: 165, listedOn: ['ebay', 'depop', 'grailed'], sold: { platform: 'depop', price: 150, daysAgo: 12, shippingCharged: 12, shippingCost: 12 } },
  { title: 'Floral Prairie Maxi Dress', brand: 'Gunne Sax', category: 'Dresses', era: '1970s', size: 'S', condition: 'Excellent', color: 'Cream floral', cost: 18, source: 'Estate sale', acquired: 95, listPrice: 145, listedOn: ['etsy'], sold: { platform: 'etsy', price: 138, daysAgo: 20, shippingCharged: 8, shippingCost: 8 } },
  { title: 'Nike Windbreaker Colorblock', brand: 'Nike', category: 'Sportswear', era: '1990s', size: 'M', condition: 'Very Good', color: 'Teal / purple', cost: 8, source: 'Goodwill Outlet', acquired: 35, listPrice: 60, listedOn: ['depop', 'poshmark'], sold: { platform: 'poshmark', price: 52, daysAgo: 5, shippingCharged: 0, shippingCost: 0 } },
  { title: 'Coach Legacy Leather Shoulder Bag', brand: 'Coach', category: 'Bags', era: '1990s', size: 'One size', condition: 'Good', color: 'Black leather', cost: 15, source: 'Thrift store', acquired: 150, listPrice: 120, listedOn: ['ebay', 'poshmark'], sold: { platform: 'ebay', price: 110, daysAgo: 100, shippingCharged: 10, shippingCost: 9.25 } },
  { title: 'Pendleton Board Shirt Plaid Wool', brand: 'Pendleton', category: 'Tops', era: '1970s', size: 'M', condition: 'Excellent', color: 'Red plaid', material: '100% virgin wool', cost: 9, source: 'Thrift store', acquired: 28, listPrice: 70, listedOn: ['ebay', 'etsy'] },
  { title: 'Champion Reverse Weave Crewneck', brand: 'Champion', category: 'Sportswear', era: '1990s', size: 'XL', condition: 'Good', color: 'Heather grey', flaws: 'Light pilling', cost: 10, source: 'Goodwill Outlet', acquired: 140, listPrice: 75, listedOn: ['ebay', 'depop'] },
  { title: 'Western Pearl Snap Shirt', brand: 'H Bar C', category: 'Tops', era: '1970s', size: 'L', condition: 'Very Good', color: 'Blue embroidered', cost: 7, source: 'Flea market', acquired: 12, listPrice: 58, listedOn: ['etsy'] },
  { title: 'Grateful Dead Tour Tee 1993', brand: 'GDM', category: 'Band & Graphic Tees', era: '1990s', size: 'L', condition: 'Good', color: 'Tie-dye', cost: 30, source: 'Estate sale', acquired: 6, listPrice: 220 },
  { title: 'Mid-Century Atomic Ashtray', brand: '', category: 'Home & Decor', era: '1950s', size: '', condition: 'Excellent', color: 'Turquoise', cost: 4, source: 'Estate sale', acquired: 3, listPrice: 38 },
  { title: 'Dr. Martens 1460 Made in England', brand: 'Dr. Martens', category: 'Shoes', era: '1990s', size: 'UK 8', condition: 'Good', color: 'Oxblood', cost: 20, source: 'Thrift store', acquired: 110, listPrice: 140, listedOn: ['ebay', 'grailed', 'depop'] },
];

export function sampleItems() {
  return SAMPLES.map((s, i) => {
    const item = {
      id: uid(),
      sku: `DEMO-${String(i + 1).padStart(3, '0')}`,
      title: s.title, brand: s.brand, category: s.category, era: s.era, size: s.size, condition: s.condition,
      color: s.color || '', material: s.material || '', measurements: s.measurements || '', flaws: s.flaws || '',
      description: '', cost: s.cost, source: s.source, acquiredDate: daysAgo(s.acquired), listPrice: s.listPrice,
      listedOn: s.listedOn || [], location: `Bin ${(i % 5) + 1}`, photos: [],
      status: s.sold ? 'sold' : (s.listedOn && s.listedOn.length ? 'listed' : 'sourced'),
      createdAt: new Date().toISOString(),
    };
    if (s.sold) {
      item.sale = {
        platform: s.sold.platform, price: s.sold.price, date: daysAgo(s.sold.daysAgo),
        shippingCharged: s.sold.shippingCharged, shippingCost: s.sold.shippingCost, otherCosts: 0,
      };
    }
    return item;
  });
}
