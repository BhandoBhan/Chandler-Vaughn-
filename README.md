# Thrift Ledger

Inventory, sales and profit tracking for vintage resellers. Offline-first, installable (PWA), no backend or dependencies. Data lives in your browser's localStorage.

## Features
- Inventory with photos, era, brand, size, measurements, flaws, SKU, storage location
- Sourcing → listed → sold pipeline, with crosslisting tracking
- Fee-aware profit per sale (eBay, Etsy, Depop, Poshmark, Grailed, Mercari; editable rates)
- Dashboard: profit by month, platform and category performance, aging inventory
- Tools: platform fee comparison, minimum-price finder, listing title/description generator
- CSV export/import and JSON backup/restore

## Run
```
npm start        # http://localhost:8080 (PORT=xxxx to change)
npm test
```
`js/app.js` is a browser ES module, so open it via the server rather than `node js/app.js`.
