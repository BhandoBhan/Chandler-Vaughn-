# Box 2 Box

**From the box to the full pitch.**

A web app for local soccer players to find and schedule pickup games near them, in three formats, plus
**wager matches** where everyone pays an entry fee and the winning team splits the pot.

| Format    | Players            | Where it's played    |
| --------- | ------------------ | -------------------- |
| **3v3**   | 6 (3 a side)       | Inside the 18-yard box |
| **8v8**   | 16 (8 a side)      | Half the field       |
| **11v11** | 22 (11 a side)     | The full field       |

Any game can be **casual** (free) or a **wager match**.

## What players can do

- **Find games nearby.** Search by their current location, a city, or a ZIP code, within 5–100 miles. Filter by
  format and by casual or wager games. See results as a list or on a map.
- **Host a game.** Pick the format, date, time, and field (search an address, tap the map, or use "I'm at the field").
  Set a skill level and notes.
- **Join a team.** Each game has Team A and Team B. The first player on each team is that team's captain.
- **Report scores.** After kickoff, players report the final score. Their stats (W-D-L, winnings) update on their
  profile.
- **Wallet.** Add funds, pay entry fees, receive winnings, and withdraw. Every transaction is listed.

## How wager matches work

1. The host sets an entry fee ($1–$100 by default). The page shows the pot, the prize pool after the platform fee,
   and what each winner takes home. Example: a $10 3v3 has a $60 pot. With a 10% fee, the prize pool is $54, so each
   winner gets $18.
2. When a player joins, their entry fee moves from their wallet into **escrow**. If they leave before kickoff, it's
   refunded right away.
3. **Both teams must be full by kickoff.** If they aren't, the match is cancelled automatically and everyone is
   refunded.
4. After the game, a **captain reports the score**. The **other team's captain confirms or disputes it**, so nobody
   can claim a prize alone.
   - **Confirmed:** the winning team splits the prize pool and payouts land in their wallets.
   - **Draw:** everyone gets their entry fee back.
   - **Disputed:** the money stays in escrow until an admin settles the match with the correct score or voids it and
     refunds everyone (the **Admin** tab).
   - **No response:** a reported score confirms automatically after 24 hours. If nobody reports a score within
     24 hours of the scheduled end, the match is refunded.
5. Players must be **18+** and have their state on their profile. States can be blocked (see configuration).

## Quick start

You need [Node.js](https://nodejs.org) **22.13 or newer**.

```bash
npm install
npm run seed      # optional: demo players and games (add --lat/--lng to put them near you)
npm start         # then open http://localhost:3000
```

Demo logins (password `password123`): `alex@example.com` for a regular player, `admin@example.com` for the admin
who handles disputes.

To put the demo games near you:

```bash
npm run seed -- --reset --lat 39.9526 --lng -75.1652 --state PA
```

Run the tests with `npm test`.

## Configuration

Set these as environment variables.

| Variable                    | Default                    | What it does |
| --------------------------- | -------------------------- | ------------ |
| `PORT`                      | `3000`                     | Port the server listens on. |
| `DATABASE_PATH`             | `data/box2box.db`          | SQLite database file. |
| `WAGERS_ENABLED`            | `true`                     | Set to `false` to turn off wager matches completely. |
| `PLATFORM_FEE_PERCENT`      | `10`                       | Share of each wager pot the platform keeps. Each game locks in the rate it was created with. |
| `WAGER_MIN_ENTRY_FEE_CENTS` | `100`                      | Minimum entry fee ($1). |
| `WAGER_MAX_ENTRY_FEE_CENTS` | `10000`                    | Maximum entry fee ($100). |
| `WAGER_MIN_AGE`             | `18`                       | Minimum age for wager matches. |
| `WAGER_BLOCKED_STATES`      | _(none)_                   | Comma-separated state codes where wager matches are off, e.g. `WA,AZ`. |
| `RESULT_WINDOW_HOURS`       | `24`                       | How long a captain has to confirm or dispute a result. |
| `PAYMENTS_MODE`             | `demo`                     | `demo` uses play money. See below. |

## Before taking real money

Out of the box, the wallet uses **play money**. Every deposit and withdrawal is simulated, so you can try the whole
wager flow safely. Before real cash changes hands:

- **Get legal advice.** Paying winners of contests that players enter for money is regulated differently in each
  state. Some states treat it as gambling, and many depend on whether it counts as a "game of skill." Find out where
  you can operate, then list the other states in `WAGER_BLOCKED_STATES`.
- **Use a licensed payment processor** to hold and move player money, for example a marketplace product like Stripe
  Connect. Don't hold the funds yourself. Add a provider in `src/payments.js` with the same `deposit` and `withdraw`
  methods as the demo one, and select it with `PAYMENTS_MODE`. The processor will also handle identity checks (KYC)
  and payouts to bank accounts.
- **Verify age and location properly.** Today players just enter a birth date and state. Real-money play needs ID
  verification and location checks.
- **Plan for taxes on winnings, terms of service, and anti-fraud rules.** Watch for no-shows and fake teams, and set
  a policy for disputes.

## How it's built

- **Server:** Node.js + Express, with SQLite through Node's built-in `node:sqlite` (no database server to install).
- **App:** a mobile-first single-page web app in plain JavaScript (`public/`), with no build step. It works on phones
  and can be added to the home screen. Maps use [Leaflet](https://leafletjs.com) and OpenStreetMap.
- **Money:** every movement of money is a row in a ledger table (`transactions`). A balance is the sum of a player's
  rows, and escrow is tracked per game, so every cent is accounted for.

```
src/
  server.js            start the server and the minute-by-minute maintenance job
  app.js               Express app, security headers, error handling
  config.js            formats (3v3/8v8/11v11) and settings
  db.js                database schema
  auth.js              passwords (scrypt) and login sessions
  payments.js          payment provider boundary (demo mode)
  services/games.js    game rules: joining, captains, results, settlement, maintenance
  services/wagers.js   payout math and wager eligibility
  services/ledger.js   wallet balances, escrow, refunds
  routes/              HTTP API
  seed.js              demo data
public/                the app (views in public/js/views)
test/                  API and wager tests (npm test)
```

## Ideas for next steps

- Native iOS and Android apps (the API is ready for them), plus push notifications when a game fills or a score needs
  confirming.
- Game chat, recurring weekly games, and invite links for private games.
- Player ratings and no-show tracking, especially for wager matches.
- Real payments, identity verification, and location checks, as described above.
