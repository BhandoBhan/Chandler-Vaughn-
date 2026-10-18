import {
  STATUSES, CATEGORIES, ERAS, CONDITIONS, num, round2, platformFee, profitFor, suggestPrice,
  daysInInventory, computeStats, nextSku, generateListing, toCsv, itemsFromCsv,
} from './calc.js';
import {
  loadItems, saveItems, loadSettings, saveSettings, uid, exportBackup, importBackup, DEFAULT_SETTINGS,
} from './store.js';
import { sampleItems } from './sample.js';

const state = {
  items: loadItems(),
  settings: loadSettings(),
  filters: { q: '', status: 'active', category: '', sort: 'newest' },
  salesMonth: '',
};

const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
const dialogBody = document.getElementById('dialog-body');

// ---------- helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(n, { signed = false } = {}) {
  const v = num(n);
  const s = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency || 'USD' }).format(Math.abs(v));
  if (v < 0) return `−${s}`;
  return signed && v > 0 ? `+${s}` : s;
}

const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);
const today = () => new Date().toISOString().slice(0, 10);
const platforms = () => state.settings.platforms;
const platformName = (key) => (platforms()[key] && platforms()[key].name) || key || '—';
const options = (list, selected) => list.map((v) => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
const platformOptions = (selected, blank = true) => (blank ? '<option value="">—</option>' : '')
  + Object.entries(platforms()).map(([k, p]) => `<option value="${esc(k)}" ${k === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function persist() {
  saveItems(state.items);
}

function openDialog(html, onMount) {
  dialogBody.innerHTML = html;
  dialog.showModal();
  dialogBody.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  if (onMount) onMount(dialogBody);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

// Downscale photos before storing so localStorage doesn't fill up.
function resizeImage(file, max = 640) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function thumb(item) {
  const src = item.photos && item.photos[0];
  return src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<span aria-hidden="true">🧥</span>';
}

function badge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(status)}</span>`;
}

// ---------- dashboard ----------

function renderDashboard() {
  const s = computeStats(state.items, platforms(), { staleDays: num(state.settings.staleDays) || 90 });
  if (!state.items.length) {
    view.innerHTML = `
      <div class="card empty">
        <h2>Welcome to Thrift Ledger</h2>
        <p>Track every piece from the bins to the buyer: what you paid, where it's listed, what it sold for, and what you actually kept after fees.</p>
        <div class="row" style="justify-content:center">
          <a class="btn btn-primary" href="#/item/new">Add your first item</a>
          <button class="btn" id="load-sample">Try with sample data</button>
        </div>
      </div>`;
    view.querySelector('#load-sample').addEventListener('click', loadSample);
    return;
  }

  const months = lastMonths(6);
  const monthData = months.map((m) => ({ m, ...(s.byMonth[m] || { profit: 0, revenue: 0, count: 0 }) }));
  const maxAbs = Math.max(1, ...monthData.map((d) => Math.abs(d.profit)));
  const recent = state.items
    .filter((i) => i.status === 'sold')
    .sort((a, b) => (b.sale.date || '').localeCompare(a.sale.date || ''))
    .slice(0, 5);
  const platRows = Object.entries(s.byPlatform).sort((a, b) => b[1].profit - a[1].profit);
  const catRows = Object.entries(s.byCategory).sort((a, b) => b[1].profit - a[1].profit).slice(0, 6);

  view.innerHTML = `
    <div class="stack">
      <h1>${esc(state.settings.businessName)}</h1>
      <div class="kpis">
        ${kpi('Profit', money(s.profit), `${s.counts.sold} sold`)}
        ${kpi('Revenue', money(s.revenue), `${money(s.fees)} in fees`)}
        ${kpi('ROI', pct(s.roi), `avg ${money(s.avgProfit)} / item`)}
        ${kpi('Days to sell', s.avgDaysToSell ?? '—', 'average')}
        ${kpi('Inventory', money(s.inventoryCost), `${s.counts.sourced + s.counts.listed} pieces at cost`)}
        ${kpi('Sell-through', pct(s.sellThrough), `${s.counts.listed} listed · ${s.counts.sourced} to list`)}
      </div>

      <div class="grid-2">
        <section class="card">
          <h2>Profit by month</h2>
          <div class="bars" role="img" aria-label="Profit for the last six months">
            ${monthData.map((d) => `
              <div class="bar-col" title="${esc(monthLabel(d.m))}: ${esc(money(d.profit))} from ${d.count} sale(s)">
                <div class="small num">${d.count ? esc(money(d.profit)) : ''}</div>
                <div class="bar ${d.profit < 0 ? 'neg-bar' : ''}" style="height:${(Math.abs(d.profit) / maxAbs) * 100}%"></div>
                <div class="bar-label">${esc(monthLabel(d.m, true))}</div>
              </div>`).join('')}
          </div>
        </section>

        <section class="card">
          <h2>Where it sells</h2>
          ${platRows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Platform</th><th class="r">Sales</th><th class="r">Revenue</th><th class="r">Profit</th></tr></thead>
            <tbody>${platRows.map(([k, v]) => `<tr><td>${esc(platformName(k))}</td><td class="r">${v.count}</td><td class="r">${money(v.revenue)}</td><td class="r">${money(v.profit)}</td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="muted">No sales yet.</p>'}
        </section>

        <section class="card">
          <h2>Best categories</h2>
          ${catRows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Category</th><th class="r">Sold</th><th class="r">Avg profit</th><th class="r">Total</th></tr></thead>
            <tbody>${catRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v.count}</td><td class="r">${money(v.profit / v.count)}</td><td class="r">${money(v.profit)}</td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="muted">No sales yet.</p>'}
        </section>

        <section class="card">
          <div class="spread"><h2>Aging inventory</h2><span class="muted small">${esc(state.settings.staleDays)}+ days unsold</span></div>
          ${s.stale.length ? `
          <div class="table-wrap"><table><tbody>
            ${s.stale.slice(0, 6).map((i) => `
              <tr class="clickable" data-href="#/item/${esc(i.id)}">
                <td>${esc(i.title)}<div class="muted small">${esc(i.sku)} · ${i.listedOn && i.listedOn.length ? esc(i.listedOn.map(platformName).join(', ')) : 'not listed'}</div></td>
                <td class="r aged">${daysInInventory(i)}d</td>
              </tr>`).join('')}
          </tbody></table></div>
          <p class="muted small">Consider a price drop, relisting, crosslisting, or bundling these.</p>` : '<p class="muted">Nothing stale. Nice turnover!</p>'}
        </section>
      </div>

      <section class="card">
        <div class="spread"><h2>Recent sales</h2><a href="#/sales" class="small">All sales →</a></div>
        ${recent.length ? salesTable(recent) : '<p class="muted">No sales yet — mark an item as sold from its page.</p>'}
      </section>
    </div>`;
  bindRowLinks();
}

function kpi(label, value, sub) {
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function monthLabel(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}

function bindRowLinks() {
  view.querySelectorAll('[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
}

// ---------- inventory ----------

function filteredItems() {
  const { q, status, category, sort } = state.filters;
  const needle = q.trim().toLowerCase();
  let list = state.items.filter((i) => {
    if (status === 'active' && i.status === 'sold') return false;
    if (status && status !== 'active' && status !== 'all' && i.status !== status) return false;
    if (category && i.category !== category) return false;
    if (needle) {
      const hay = [i.title, i.brand, i.sku, i.era, i.size, i.color, i.source, i.location, i.category].join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const sorters = {
    newest: (a, b) => (b.acquiredDate || '').localeCompare(a.acquiredDate || ''),
    oldest: (a, b) => (a.acquiredDate || '').localeCompare(b.acquiredDate || ''),
    priceHigh: (a, b) => num(b.listPrice) - num(a.listPrice),
    priceLow: (a, b) => num(a.listPrice) - num(b.listPrice),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
  };
  list = list.slice().sort(sorters[sort] || sorters.newest);
  return list;
}

function renderInventory() {
  const f = state.filters;
  view.innerHTML = `
    <div class="stack">
      <div class="spread">
        <h1>Inventory</h1>
        <span class="muted small" id="inv-count"></span>
      </div>
      <div class="filters">
        <input class="search" type="search" id="f-q" placeholder="Search title, brand, SKU, era, bin…" value="${esc(f.q)}" aria-label="Search inventory">
        <select id="f-status" aria-label="Status">
          <option value="active" ${f.status === 'active' ? 'selected' : ''}>Unsold</option>
          <option value="all" ${f.status === 'all' ? 'selected' : ''}>All statuses</option>
          ${STATUSES.map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        <select id="f-category" aria-label="Category"><option value="">All categories</option>${options(CATEGORIES, f.category)}</select>
        <select id="f-sort" aria-label="Sort">
          <option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>Newest first</option>
          <option value="oldest" ${f.sort === 'oldest' ? 'selected' : ''}>Oldest first</option>
          <option value="priceHigh" ${f.sort === 'priceHigh' ? 'selected' : ''}>Price: high → low</option>
          <option value="priceLow" ${f.sort === 'priceLow' ? 'selected' : ''}>Price: low → high</option>
          <option value="title" ${f.sort === 'title' ? 'selected' : ''}>Title A–Z</option>
        </select>
      </div>
      <div id="inv-list"></div>
    </div>`;

  const update = () => {
    const list = filteredItems();
    const stale = num(state.settings.staleDays) || 90;
    view.querySelector('#inv-count').textContent = `${list.length} of ${state.items.length} items`;
    view.querySelector('#inv-list').innerHTML = list.length ? `<div class="items">${list.map((i) => {
      const days = daysInInventory(i);
      const price = i.status === 'sold' ? num(i.sale && i.sale.price) : num(i.listPrice);
      return `
        <a class="item-card" href="#/item/${esc(i.id)}">
          <div class="thumb">${thumb(i)}</div>
          <div class="body">
            <div class="row" style="justify-content:space-between">${badge(i.status)}<span class="meta">${esc(i.sku)}</span></div>
            <div class="title">${esc(i.title || 'Untitled')}</div>
            <div class="meta">${esc([i.era, i.brand, i.size].filter(Boolean).join(' · '))}</div>
            <div class="row" style="justify-content:space-between;margin-top:auto">
              <span class="price">${price ? money(price) : '<span class="muted">No price</span>'}</span>
              ${i.status !== 'sold' && days !== null ? `<span class="meta ${days >= stale ? 'aged' : ''}">${days}d</span>` : ''}
            </div>
          </div>
        </a>`;
    }).join('')}</div>` : `<div class="card empty"><h2>No items match</h2><p>Try a different search or <a href="#/item/new">add an item</a>.</p></div>`;
  };

  view.querySelector('#f-q').addEventListener('input', (e) => { f.q = e.target.value; update(); });
  view.querySelector('#f-status').addEventListener('change', (e) => { f.status = e.target.value; update(); });
  view.querySelector('#f-category').addEventListener('change', (e) => { f.category = e.target.value; update(); });
  view.querySelector('#f-sort').addEventListener('change', (e) => { f.sort = e.target.value; update(); });
  update();
}

// ---------- item form ----------

function renderItem(id) {
  const existing = id !== 'new' ? state.items.find((i) => i.id === id) : null;
  if (id !== 'new' && !existing) {
    view.innerHTML = '<div class="card empty"><h2>Item not found</h2><a href="#/inventory">Back to inventory</a></div>';
    return;
  }
  const item = existing ? structuredClone(existing) : {
    id: uid(), sku: nextSku(state.items, state.settings.skuPrefix || 'VTG'), status: 'sourced',
    acquiredDate: today(), listedOn: [], photos: [], category: '', era: '', condition: '',
  };
  const listedPlatforms = Object.entries(platforms()).filter(([k]) => k !== 'instore');

  view.innerHTML = `
    <form id="item-form" class="stack" novalidate>
      <div class="spread">
        <div>
          <a href="#/inventory" class="small">← Inventory</a>
          <h1>${existing ? esc(item.title || 'Untitled') : 'New item'}</h1>
        </div>
        <div class="row">${existing ? badge(item.status) : ''}${existing && daysInInventory(item) !== null ? `<span class="muted small">${daysInInventory(item)} days ${item.status === 'sold' ? 'to sell' : 'in stock'}</span>` : ''}</div>
      </div>

      ${item.status === 'sold' ? soldSummary(item) : ''}

      <fieldset>
        <legend>Photos</legend>
        <div class="photo-row" id="photos"></div>
      </fieldset>

      <fieldset>
        <legend>The piece</legend>
        <div class="form-grid">
          <div class="full"><label for="title">Title</label><input id="title" name="title" required placeholder="e.g. Harley-Davidson Ringer Tee" value="${esc(item.title)}"></div>
          <div><label for="brand">Brand / Label</label><input id="brand" name="brand" value="${esc(item.brand)}"></div>
          <div><label for="category">Category</label><select id="category" name="category"><option value="">—</option>${options(CATEGORIES, item.category)}</select></div>
          <div><label for="era">Era</label><select id="era" name="era"><option value="">—</option>${options(ERAS, item.era)}</select></div>
          <div><label for="size">Tag size</label><input id="size" name="size" value="${esc(item.size)}"></div>
          <div><label for="condition">Condition</label><select id="condition" name="condition"><option value="">—</option>${options(CONDITIONS, item.condition)}</select></div>
          <div><label for="color">Color</label><input id="color" name="color" value="${esc(item.color)}"></div>
          <div class="half"><label for="material">Material</label><input id="material" name="material" placeholder="e.g. 50/50 cotton poly" value="${esc(item.material)}"></div>
          <div class="full"><label for="measurements">Measurements</label><input id="measurements" name="measurements" placeholder='e.g. Pit to pit 21", length 28"' value="${esc(item.measurements)}"></div>
          <div class="full"><label for="flaws">Flaws</label><input id="flaws" name="flaws" placeholder="Pinhole on left sleeve, light fading" value="${esc(item.flaws)}"></div>
          <div class="full"><label for="description">Notes / description</label><textarea id="description" name="description">${esc(item.description)}</textarea></div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Sourcing &amp; listing</legend>
        <div class="form-grid">
          <div><label for="sku">SKU</label><input id="sku" name="sku" value="${esc(item.sku)}"></div>
          <div><label for="cost">Cost</label><input id="cost" name="cost" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(item.cost ?? '')}"></div>
          <div><label for="source">Source</label><input id="source" name="source" list="sources" placeholder="Goodwill bins, estate sale…" value="${esc(item.source)}"></div>
          <div><label for="acquiredDate">Acquired</label><input id="acquiredDate" name="acquiredDate" type="date" value="${esc(item.acquiredDate)}"></div>
          <div><label for="listPrice">List price</label><input id="listPrice" name="listPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(item.listPrice ?? '')}"></div>
          <div><label for="location">Storage location</label><input id="location" name="location" placeholder="Bin 4, rack B" value="${esc(item.location)}"></div>
          <div class="half"><label for="status">Status</label>
            <select id="status" name="status" ${item.status === 'sold' ? 'disabled' : ''}>
              <option value="sourced" ${item.status === 'sourced' ? 'selected' : ''}>Sourced (not listed yet)</option>
              <option value="listed" ${item.status === 'listed' ? 'selected' : ''}>Listed</option>
              ${item.status === 'sold' ? '<option value="sold" selected>Sold</option>' : ''}
            </select>
          </div>
          <div class="full">
            <label>Listed on</label>
            <div class="checks">${listedPlatforms.map(([k, p]) => `<label><input type="checkbox" name="listedOn" value="${esc(k)}" ${item.listedOn.includes(k) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
          </div>
          <div class="full muted small" id="price-hint"></div>
        </div>
        <datalist id="sources">${[...new Set(state.items.map((i) => i.source).filter(Boolean))].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      </fieldset>

      <div class="sticky-actions row">
        <button type="submit" class="btn btn-primary">Save</button>
        ${item.status !== 'sold' ? '<button type="button" class="btn" id="mark-sold">Mark sold</button>' : '<button type="button" class="btn" id="edit-sale">Edit sale</button><button type="button" class="btn" id="unsell">Undo sale</button>'}
        <button type="button" class="btn" id="gen-listing">Listing text</button>
        ${existing ? '<button type="button" class="btn" id="duplicate">Duplicate</button><button type="button" class="btn btn-danger" id="delete">Delete</button>' : ''}
      </div>
    </form>`;

  const form = view.querySelector('#item-form');

  const collect = () => {
    const fd = new FormData(form);
    const out = { ...item };
    for (const k of ['title', 'brand', 'category', 'era', 'size', 'condition', 'color', 'material', 'measurements', 'flaws', 'description', 'sku', 'source', 'acquiredDate', 'location']) {
      out[k] = (fd.get(k) || '').toString().trim();
    }
    out.cost = round2(num(fd.get('cost')));
    out.listPrice = round2(num(fd.get('listPrice')));
    out.listedOn = fd.getAll('listedOn');
    if (item.status !== 'sold') {
      out.status = fd.get('status') || 'sourced';
      if (out.listedOn.length && out.status === 'sourced') out.status = 'listed';
    }
    out.photos = item.photos;
    out.updatedAt = new Date().toISOString();
    return out;
  };

  const upsert = (next) => {
    const idx = state.items.findIndex((i) => i.id === next.id);
    if (idx >= 0) state.items[idx] = next; else state.items.push({ ...next, createdAt: new Date().toISOString() });
    persist();
  };

  const renderPhotos = () => {
    const wrap = view.querySelector('#photos');
    wrap.innerHTML = item.photos.map((src, i) => `<div class="photo"><img src="${esc(src)}" alt="Photo ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join('')
      + (item.photos.length < 6 ? '<label class="photo-add">+ Add photo<input type="file" accept="image/*" multiple id="photo-input"></label>' : '');
    wrap.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { item.photos.splice(Number(b.dataset.rm), 1); renderPhotos(); }));
    const input = wrap.querySelector('#photo-input');
    if (input) {
      input.addEventListener('change', async () => {
        for (const file of [...input.files].slice(0, 6 - item.photos.length)) {
          try { item.photos.push(await resizeImage(file)); } catch { toast('Could not read that image'); }
        }
        renderPhotos();
      });
    }
  };
  renderPhotos();

  const hint = () => {
    const cost = num(form.cost.value);
    const target = num(state.settings.defaultTargetProfit);
    const list = num(form.listPrice.value);
    const parts = [];
    if (cost > 0) {
      const sug = ['ebay', 'depop', 'poshmark']
        .filter((k) => platforms()[k])
        .map((k) => `${platforms()[k].name} ${money(suggestPrice({ cost, targetProfit: target, platform: platforms()[k] }))}`);
      parts.push(`To clear ${money(target)} profit (before shipping): ${sug.join(' · ')}.`);
    }
    if (cost > 0 && list > 0) {
      const p = platforms().ebay;
      const net = round2(list - cost - platformFee(p, list));
      parts.push(`At ${money(list)} on eBay you'd net about <strong class="${net >= 0 ? 'pos' : 'neg'}">${money(net)}</strong>.`);
    }
    view.querySelector('#price-hint').innerHTML = parts.join(' ');
  };
  form.cost.addEventListener('input', hint);
  form.listPrice.addEventListener('input', hint);
  hint();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = collect();
    if (!next.title) { form.title.focus(); toast('Give it a title first'); return; }
    upsert(next);
    toast('Saved');
    location.hash = '#/inventory';
  });

  const markSold = (btnItem) => openSaleDialog(btnItem, (sale) => {
    const next = { ...btnItem, status: 'sold', sale };
    upsert(next);
    toast(`Sold! ${money(profitFor(next, platforms()).profit, { signed: true })} profit`);
    renderItem(next.id);
  });

  view.querySelector('#mark-sold')?.addEventListener('click', () => {
    const next = collect();
    if (!next.title) { form.title.focus(); toast('Give it a title first'); return; }
    markSold(next);
  });
  view.querySelector('#edit-sale')?.addEventListener('click', () => markSold(collect()));
  view.querySelector('#unsell')?.addEventListener('click', () => {
    if (!confirm('Move this item back to inventory and remove the sale record?')) return;
    const next = collect();
    delete next.sale;
    next.status = next.listedOn.length ? 'listed' : 'sourced';
    upsert(next);
    toast('Sale removed');
    renderItem(next.id);
  });
  view.querySelector('#gen-listing').addEventListener('click', () => openListingDialog(collect()));
  view.querySelector('#duplicate')?.addEventListener('click', () => {
    const copy = { ...collect(), id: uid(), sku: nextSku(state.items, state.settings.skuPrefix || 'VTG'), status: 'sourced', listedOn: [], photos: [...item.photos] };
    delete copy.sale;
    upsert(copy);
    toast('Duplicated');
    location.hash = `#/item/${copy.id}`;
  });
  view.querySelector('#delete')?.addEventListener('click', () => {
    if (!confirm(`Delete "${item.title || 'this item'}"? This can't be undone.`)) return;
    state.items = state.items.filter((i) => i.id !== item.id);
    persist();
    toast('Deleted');
    location.hash = '#/inventory';
  });
}

function soldSummary(item) {
  const p = profitFor(item, platforms());
  const s = item.sale;
  return `
    <section class="card">
      <div class="spread"><h2>Sold on ${esc(platformName(s.platform))}</h2><span class="muted small">${esc(s.date)}</span></div>
      <div class="summary-line"><span>Sale price + shipping charged</span><span>${money(p.revenue)}</span></div>
      <div class="summary-line"><span>Item cost</span><span>−${money(item.cost)}</span></div>
      <div class="summary-line"><span>Platform fees</span><span>−${money(p.fees)}</span></div>
      <div class="summary-line"><span>Shipping &amp; other costs</span><span>−${money(num(s.shippingCost) + num(s.otherCosts))}</span></div>
      <div class="summary-line total"><span>Profit</span><span class="${p.profit >= 0 ? 'pos' : 'neg'}">${money(p.profit)}</span></div>
      <div class="muted small">ROI ${pct(p.roi)} · margin ${pct(p.margin)}</div>
    </section>`;
}

function openSaleDialog(item, onSave) {
  const s = item.sale || {};
  const defaultPlatform = s.platform || (item.listedOn && item.listedOn[0]) || 'ebay';
  openDialog(`
    <form id="sale-form" class="stack" method="dialog">
      <h2>Record sale</h2>
      <p class="muted small">${esc(item.title)} · cost ${money(item.cost)}</p>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div><label for="s-platform">Sold on</label><select id="s-platform" name="platform">${platformOptions(defaultPlatform, false)}</select></div>
        <div><label for="s-date">Date</label><input id="s-date" name="date" type="date" value="${esc(s.date || today())}"></div>
        <div><label for="s-price">Sale price</label><input id="s-price" name="price" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(s.price ?? item.listPrice ?? '')}" required></div>
        <div><label for="s-shipc">Shipping charged</label><input id="s-shipc" name="shippingCharged" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(s.shippingCharged ?? '')}"></div>
        <div><label for="s-shipcost">Your shipping cost</label><input id="s-shipcost" name="shippingCost" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(s.shippingCost ?? '')}"></div>
        <div><label for="s-other">Other costs</label><input id="s-other" name="otherCosts" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Promoted fee, supplies" value="${esc(s.otherCosts ?? '')}"></div>
        <div class="full"><label for="s-fees">Platform fees <span class="muted">(blank = estimate)</span></label><input id="s-fees" name="fees" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(s.fees ?? '')}"></div>
      </div>
      <div class="card" id="sale-preview"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Save sale</button>
      </div>
    </form>`, (root) => {
    const form = root.querySelector('#sale-form');
    const read = () => {
      const fd = new FormData(form);
      const fees = fd.get('fees');
      return {
        platform: fd.get('platform'), date: fd.get('date') || today(), price: round2(num(fd.get('price'))),
        shippingCharged: round2(num(fd.get('shippingCharged'))), shippingCost: round2(num(fd.get('shippingCost'))),
        otherCosts: round2(num(fd.get('otherCosts'))), fees: fees === '' ? undefined : round2(num(fees)),
      };
    };
    const preview = () => {
      const sale = read();
      const p = profitFor({ ...item, sale }, platforms());
      root.querySelector('#sale-preview').innerHTML = `
        <div class="summary-line"><span>Fees${sale.fees === undefined ? ' (est.)' : ''}</span><span>${money(p.fees)}</span></div>
        <div class="summary-line total"><span>Profit</span><span class="${p.profit >= 0 ? 'pos' : 'neg'}">${money(p.profit)}</span></div>
        <div class="muted small">ROI ${pct(p.roi)}</div>`;
    };
    form.addEventListener('input', preview);
    preview();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const sale = read();
      if (!(sale.price > 0)) { form.price.focus(); return; }
      dialog.close();
      onSave(sale);
    });
  });
}

function openListingDialog(item) {
  const { title, description } = generateListing(item);
  openDialog(`
    <div class="stack">
      <h2>Listing text</h2>
      <div><label>Title <span class="muted">(${title.length}/80)</span></label><pre class="listing" id="l-title">${esc(title)}</pre></div>
      <div><label>Description</label><pre class="listing" id="l-desc">${esc(description)}</pre></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-copy="l-title">Copy title</button>
        <button class="btn" data-copy="l-desc">Copy description</button>
        <button class="btn btn-primary" data-close>Done</button>
      </div>
    </div>`, (root) => {
    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(root.querySelector(`#${b.dataset.copy}`).textContent);
        toast('Copied');
      } catch { toast('Copy failed — select the text manually'); }
    }));
  });
}

// ---------- sales ----------

function salesTable(list) {
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Item</th><th>Platform</th><th>Date</th><th class="r">Sold</th><th class="r">Fees</th><th class="r">Profit</th></tr></thead>
      <tbody>${list.map((i) => {
        const p = profitFor(i, platforms());
        return `<tr class="clickable" data-href="#/item/${esc(i.id)}">
          <td>${esc(i.title)}<div class="muted small">${esc(i.sku)}</div></td>
          <td>${esc(platformName(i.sale.platform))}</td>
          <td class="num">${esc(i.sale.date)}</td>
          <td class="r">${money(p.revenue)}</td>
          <td class="r">${money(p.fees)}</td>
          <td class="r ${p.profit >= 0 ? 'pos' : 'neg'}">${money(p.profit)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function renderSales() {
  const sold = state.items.filter((i) => i.status === 'sold' && i.sale)
    .sort((a, b) => (b.sale.date || '').localeCompare(a.sale.date || ''));
  const months = [...new Set(sold.map((i) => (i.sale.date || '').slice(0, 7)).filter(Boolean))];
  const list = state.salesMonth ? sold.filter((i) => (i.sale.date || '').startsWith(state.salesMonth)) : sold;
  const s = computeStats(list, platforms());

  view.innerHTML = `
    <div class="stack">
      <div class="spread">
        <h1>Sales</h1>
        <div class="row">
          <select id="sales-month" aria-label="Month">
            <option value="">All time</option>
            ${months.map((m) => `<option value="${m}" ${m === state.salesMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
          </select>
          <button class="btn" id="sales-csv">Export CSV</button>
        </div>
      </div>
      <div class="kpis">
        ${kpi('Sales', s.counts.sold, '')}
        ${kpi('Revenue', money(s.revenue), '')}
        ${kpi('Fees', money(s.fees), '')}
        ${kpi('Cost of goods', money(s.soldCost), '')}
        ${kpi('Profit', money(s.profit), '')}
        ${kpi('ROI', pct(s.roi), '')}
      </div>
      <section class="card">${list.length ? salesTable(list) : '<p class="muted">No sales in this period.</p>'}</section>
    </div>`;
  view.querySelector('#sales-month').addEventListener('change', (e) => { state.salesMonth = e.target.value; renderSales(); });
  view.querySelector('#sales-csv').addEventListener('click', () => download(`sales-${state.salesMonth || 'all'}.csv`, toCsv(list, platforms()), 'text/csv'));
  bindRowLinks();
}

// ---------- tools ----------

function renderTools() {
  view.innerHTML = `
    <div class="stack">
      <h1>Tools</h1>
      <section class="card stack">
        <div>
          <h2>Fee &amp; profit calculator</h2>
          <p class="muted small">Compare what you'd actually keep on each platform. Fee rates are estimates — adjust them in Settings.</p>
        </div>
        <div class="form-grid">
          <div><label for="c-cost">Item cost</label><input id="c-cost" type="number" step="0.01" min="0" inputmode="decimal" value="8"></div>
          <div><label for="c-price">Sale price</label><input id="c-price" type="number" step="0.01" min="0" inputmode="decimal" value="45"></div>
          <div><label for="c-shipc">Shipping charged</label><input id="c-shipc" type="number" step="0.01" min="0" inputmode="decimal" value="0"></div>
          <div><label for="c-shipcost">Your shipping cost</label><input id="c-shipcost" type="number" step="0.01" min="0" inputmode="decimal" value="0"></div>
        </div>
        <div class="table-wrap" id="calc-out"></div>
      </section>

      <section class="card stack">
        <div>
          <h2>Price finder</h2>
          <p class="muted small">The minimum list price that hits your profit goal after fees and shipping.</p>
        </div>
        <div class="form-grid">
          <div><label for="p-cost">Item cost</label><input id="p-cost" type="number" step="0.01" min="0" inputmode="decimal" value="8"></div>
          <div><label for="p-target">Profit goal</label><input id="p-target" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(state.settings.defaultTargetProfit)}"></div>
          <div><label for="p-shipc">Shipping charged</label><input id="p-shipc" type="number" step="0.01" min="0" inputmode="decimal" value="0"></div>
          <div><label for="p-shipcost">Your shipping cost</label><input id="p-shipcost" type="number" step="0.01" min="0" inputmode="decimal" value="0"></div>
        </div>
        <div class="table-wrap" id="price-out"></div>
      </section>
    </div>`;

  const v = (id) => num(view.querySelector(id).value);
  const calc = () => {
    const cost = v('#c-cost'); const price = v('#c-price'); const shipc = v('#c-shipc'); const shipcost = v('#c-shipcost');
    const rows = Object.entries(platforms()).map(([k, p]) => {
      const r = profitFor({ cost, sale: { platform: k, price, shippingCharged: shipc, shippingCost: shipcost } }, platforms());
      return { name: p.name, ...r };
    }).sort((a, b) => b.profit - a.profit);
    view.querySelector('#calc-out').innerHTML = `<table>
      <thead><tr><th>Platform</th><th class="r">Fees</th><th class="r">Profit</th><th class="r">ROI</th><th class="r">Margin</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${money(r.fees)}</td><td class="r ${r.profit >= 0 ? 'pos' : 'neg'}">${money(r.profit)}</td><td class="r">${pct(r.roi)}</td><td class="r">${pct(r.margin)}</td></tr>`).join('')}</tbody>
    </table>`;
  };
  const price = () => {
    const args = { cost: v('#p-cost'), targetProfit: v('#p-target'), shippingCharged: v('#p-shipc'), shippingCost: v('#p-shipcost') };
    const rows = Object.entries(platforms()).map(([, p]) => ({ name: p.name, price: suggestPrice({ ...args, platform: p }) }));
    view.querySelector('#price-out').innerHTML = `<table>
      <thead><tr><th>Platform</th><th class="r">List at least</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.price === null ? '—' : money(r.price)}</td></tr>`).join('')}</tbody>
    </table>`;
  };
  ['#c-cost', '#c-price', '#c-shipc', '#c-shipcost'].forEach((id) => view.querySelector(id).addEventListener('input', calc));
  ['#p-cost', '#p-target', '#p-shipc', '#p-shipcost'].forEach((id) => view.querySelector(id).addEventListener('input', price));
  calc();
  price();
}

// ---------- settings ----------

function renderSettings() {
  const st = state.settings;
  view.innerHTML = `
    <div class="stack">
      <h1>Settings</h1>
      <form id="settings-form" class="stack">
        <fieldset>
          <legend>Shop</legend>
          <div class="form-grid">
            <div class="half"><label for="businessName">Shop name</label><input id="businessName" name="businessName" value="${esc(st.businessName)}"></div>
            <div><label for="currency">Currency</label><input id="currency" name="currency" maxlength="3" value="${esc(st.currency)}"></div>
            <div><label for="skuPrefix">SKU prefix</label><input id="skuPrefix" name="skuPrefix" value="${esc(st.skuPrefix)}"></div>
            <div><label for="staleDays">"Aging" after (days)</label><input id="staleDays" name="staleDays" type="number" min="1" value="${esc(st.staleDays)}"></div>
            <div><label for="defaultTargetProfit">Default profit goal</label><input id="defaultTargetProfit" name="defaultTargetProfit" type="number" min="0" step="0.01" value="${esc(st.defaultTargetProfit)}"></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Platform fees</legend>
          <p class="muted small">Estimated combined selling + payment processing fees. Marketplaces change these often — check your latest statements and update.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Platform</th><th>% of sale + shipping</th><th>Flat per order</th></tr></thead>
            <tbody>${Object.entries(st.platforms).map(([k, p]) => `
              <tr>
                <td>${esc(p.name)}${p.smallOrderThreshold ? `<div class="muted small">${money(p.smallOrderFlat)} flat under ${money(p.smallOrderThreshold)}</div>` : ''}</td>
                <td><input name="pct-${esc(k)}" type="number" step="0.01" min="0" max="99" value="${esc(p.percent)}" aria-label="${esc(p.name)} percent"></td>
                <td><input name="fix-${esc(k)}" type="number" step="0.01" min="0" value="${esc(p.fixed)}" aria-label="${esc(p.name)} flat fee"></td>
              </tr>`).join('')}</tbody>
          </table></div>
          <button type="button" class="btn btn-sm" id="reset-fees" style="margin-top:8px">Reset to defaults</button>
        </fieldset>
        <div><button type="submit" class="btn btn-primary">Save settings</button></div>
      </form>

      <fieldset class="stack">
        <legend>Your data</legend>
        <p class="muted small">Everything is stored only in this browser. Export a backup regularly, and use it to move to another device.</p>
        <div class="row">
          <button class="btn" id="export-json">Download backup</button>
          <label class="btn" style="margin:0;color:var(--text);font-size:inherit">Restore backup<input type="file" accept="application/json,.json" id="import-json" hidden></label>
          <button class="btn" id="export-csv">Export inventory CSV</button>
          <label class="btn" style="margin:0;color:var(--text);font-size:inherit">Import CSV<input type="file" accept=".csv,text/csv" id="import-csv" hidden></label>
        </div>
        <div class="row">
          <button class="btn" id="sample">Load sample data</button>
          <button class="btn btn-danger" id="clear">Erase all data</button>
        </div>
      </fieldset>
    </div>`;

  const form = view.querySelector('#settings-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const next = {
      ...st,
      businessName: fd.get('businessName').trim() || DEFAULT_SETTINGS.businessName,
      currency: (fd.get('currency').trim() || 'USD').toUpperCase(),
      skuPrefix: fd.get('skuPrefix').trim() || 'VTG',
      staleDays: Math.max(1, Math.round(num(fd.get('staleDays'))) || 90),
      defaultTargetProfit: num(fd.get('defaultTargetProfit')),
      platforms: Object.fromEntries(Object.entries(st.platforms).map(([k, p]) => [k, {
        ...p, percent: num(fd.get(`pct-${k}`)), fixed: num(fd.get(`fix-${k}`)),
      }])),
    };
    try { new Intl.NumberFormat(undefined, { style: 'currency', currency: next.currency }); } catch { toast('Unknown currency code'); return; }
    state.settings = next;
    saveSettings(next);
    applyBranding();
    toast('Settings saved');
  });
  view.querySelector('#reset-fees').addEventListener('click', () => {
    state.settings = { ...st, platforms: DEFAULT_SETTINGS.platforms };
    saveSettings(state.settings);
    renderSettings();
    toast('Fees reset');
  });
  view.querySelector('#export-json').addEventListener('click', () => download(`thrift-ledger-backup-${today()}.json`, exportBackup(), 'application/json'));
  view.querySelector('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (state.items.length && !confirm('Restoring replaces all current items and settings. Continue?')) return;
    try {
      const n = importBackup(await readFile(file));
      state.items = loadItems();
      state.settings = loadSettings();
      applyBranding();
      toast(`Restored ${n} items`);
      renderSettings();
    } catch (err) { toast(err.message || 'Could not read backup'); }
  });
  view.querySelector('#export-csv').addEventListener('click', () => download(`inventory-${today()}.csv`, toCsv(state.items, platforms()), 'text/csv'));
  view.querySelector('#import-csv').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const rows = itemsFromCsv(await readFile(file));
      for (const r of rows) {
        state.items.push({ ...r, id: uid(), photos: [], sku: r.sku || nextSku(state.items, st.skuPrefix), acquiredDate: r.acquiredDate || today(), createdAt: new Date().toISOString() });
      }
      persist();
      toast(`Imported ${rows.length} items`);
    } catch { toast('Could not read that CSV'); }
    e.target.value = '';
  });
  view.querySelector('#sample').addEventListener('click', loadSample);
  view.querySelector('#clear').addEventListener('click', () => {
    if (!confirm('Erase every item and sale? Download a backup first if you might want them back.')) return;
    state.items = [];
    persist();
    toast('All data erased');
  });
}

function loadSample() {
  const items = sampleItems();
  state.items.push(...items);
  persist();
  toast(`Added ${items.length} sample items`);
  location.hash = '#/dashboard';
  route();
}

// ---------- router ----------

function applyBranding() {
  document.getElementById('brand-name').textContent = state.settings.businessName || 'Thrift Ledger';
}

function route() {
  const [, name = 'dashboard', arg] = location.hash.replace(/^#/, '').split('/');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === (name === 'item' ? 'inventory' : name)));
  if (dialog.open) dialog.close();
  const routes = { dashboard: renderDashboard, inventory: renderInventory, sales: renderSales, tools: renderTools, settings: renderSettings };
  if (name === 'item') renderItem(arg || 'new');
  else (routes[name] || renderDashboard)();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('storage', () => { state.items = loadItems(); state.settings = loadSettings(); route(); });
applyBranding();
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
