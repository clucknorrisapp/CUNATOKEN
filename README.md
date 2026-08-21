# CUNALINGUS ($CUNA) — website

Single-page site for the $CUNA community. Static files only: no build step, no
backend, no secrets. Every number on the page is read live, client-side, from
public APIs.

```
index.html          main page: hero, burn tracker, bag checker, stats, community
buy.html            the Jupiter swap widget, on its own so it can breathe
safety.html         the long-form "is it safe?" answers
assets/styles.css   sticker-book styles, shared by all three pages
assets/app.js       config + live data + interactions, shared by all three
assets/logo.jpg     the coin art
assets/memes/       meme gallery images (drop files here)
nixpacks.toml       inert — see "Deploying on Railway"
railway.json        inert — see "Deploying on Railway"
```

### Three pages, one script

`app.js` is loaded by all three pages and no-ops on anything that isn't
present — every builder starts with a `$()` lookup and returns early if its
element is missing. So the burn tracker code simply does nothing on `buy.html`,
and the swap code does nothing on `index.html`. If you add a feature, keep that
property: guard on the element, don't guard on the page.

The header and footer are duplicated across the three files. That is the cost
of having no build step, and it is deliberate — if you change the nav, change
it in all three.

### Where the safety copy lives

Each page carries a one-line notice and links to `safety.html` for the detail.
The short lines are the load-bearing ones and should stay: read-only on the bag
checker, and "a swap asks you to sign" on the buy page. The long-form page is
where the drainer-vs-swap explanation, the unverified-token explanation and the
impostor-mint warning live. Keep it that way — the inline copy had grown into a
wall of text that nobody was going to read.

## Run it locally

Any static file server works. With Python:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` straight off disk mostly works too, but a server is
closer to production.

## Where the numbers come from

| Shown on page | Source | Notes |
| --- | --- | --- |
| Price, market cap, 24h change, volume, liquidity, txns | [DexScreener API](https://docs.dexscreener.com/api/reference) for the main Orca pool | CORS-open, keyless |
| Circulating supply, burn progress | Solana JSON-RPC `getTokenSupply` | `solana-rpc.publicnode.com`, falling back to `api.mainnet-beta.solana.com` |
| A wallet's $CUNA balance (connected or pasted) | Solana JSON-RPC `getTokenAccountsByOwner` | Same endpoints; read-only, see below |
| Balance waiting in the burn wallet | Solana JSON-RPC `getTokenAccountsByOwner` | Only when `burnWallet` is configured |
| Price impact on the buy section | [Jupiter quote API](https://lite-api.jup.ag/swap/v1/quote) | CORS-open, keyless |

Data refreshes every 30 seconds while the tab is visible. If both sources fail
the page keeps its last values and says so instead of showing zeros.

Nothing fetched from an API is ever inserted as HTML — every value goes through
`textContent` after being coerced to a number, so a hostile API response can't
inject markup.

## The wallet connect is read-only, and must stay that way

"Check your bag" offers two routes to the same answer:

1. **Connect a wallet** — read-only.
2. **Paste an address** — touches no wallet at all. A public address goes into
   a public RPC read. This is strictly safer than route 1 and is offered as a
   first-class option, not a fallback, because plenty of people sensibly don't
   want to connect a wallet to a memecoin site.

The **only** wallet methods `app.js` ever calls are `connect()` and
`disconnect()`. It never calls `signTransaction`, `signAllTransactions`,
`signMessage` or `signAndSendTransaction`, and it never constructs a
transaction — so connecting cannot move a visitor's funds, and the page has
nothing to steal.

How it works:

1. Detect injected providers (Phantom, Solflare, Backpack, Glow). Detection
   only reads `window` — it calls nothing.
2. `connect()` returns a public address. That address is checked against a
   base58 pattern before it is used or displayed.
3. The balance comes from a public RPC `getTokenAccountsByOwner` filtered to
   the $CUNA mint, summed across the owner's token accounts.
4. On load the page tries `connect({ onlyIfTrusted: true })`, which
   reconnects silently for visitors who already approved the site and does
   nothing at all for everyone else. No popup is ever triggered unprompted.

If someone later wants a feature that needs a signature, treat it as a new
feature with a completely different threat model — don't quietly widen this
one. The safety copy on the page tells visitors we will never ask them to
sign, and that promise is only worth anything if the code keeps it.

## The buy widget (Jupiter Plugin)

The Buy section embeds Jupiter's swap widget. Things worth knowing before
touching it:

**Use `plugin.jup.ag/plugin-v1.js`.** "Jupiter Terminal"
(`terminal.jup.ag/main-v2.js`, `main-v4.js`) is the retired predecessor —
Jupiter's Terminal docs now redirect to the Plugin page. All three URLs still
return HTTP 200, so a 200 is not evidence of currency. `main-v2` in particular
has no Shadow DOM and injects its Tailwind reset into the host document, which
would wreck this stylesheet sitewide.

**The option is `fixedMint`, singular.** `fixedOutputMint` was a Terminal-era
option and is silently ignored by the Plugin — copy an old snippet and users
get a wide-open token picker instead of a locked one. `fixedMint` is what stops
anyone buying an impostor token called CUNA through this page.

**`autoConnect` defaults to `true`.** It is explicitly set to `false`. Leaving
it out would silently reconnect a visitor's wallet on every later visit, which
is the opposite of what this page offers people.

**`init()` returns a promise and rejects — it does not throw.** A `try/catch`
around it catches nothing. It must also be called after the script's `onload`,
and the target div must already exist.

**No RPC.** The plugin runs on Jupiter's hosted Ultra API. There is no endpoint
to configure and nothing here to rate-limit.

### Why it loads on a click

The script is injected in JS when the button is pressed, not written into
`index.html`. Three reasons: visitors who only came to read the burn tracker
never execute third-party code on this origin; the disclosure next to the
button ("nothing from Jupiter is loaded until you press this") is only honest
if it is true; and the widget is ~320 KB gzipped against a page that is
currently ~18 KB.

### The one line of price impact

The widget shows dollar amounts but never a price-impact percentage, and in a
pool this thin that difference is the whole story — a 2 SOL buy currently costs
about 15% and Jupiter's UI will not say so. So `app.js` quotes
`lite-api.jup.ag/swap/v1/quote` itself and prints one line under the widget for
whatever amount is typed, amber past `CONFIG.jupiter.warnPct`, red past
`badPct`.

There used to be a table of impact-at-various-sizes above the widget as well.
It was removed deliberately: it read like a trading terminal on what is a meme
coin site. The single live line stays because it is small, it only appears once
someone has typed an amount, and it is the only price-impact figure a buyer
gets from anywhere.

Note `quote-api.jup.ag/v6` is dead (502) — use `lite-api.jup.ag/swap/v1/quote`.

### The failure path is not optional

The plugin fetches its stylesheets with `Promise.all`, and one of them is from
Google Fonts. Any single rejection discards all of them and the widget renders
as an empty box with no error — and blocking `fonts.googleapis.com` is common
among exactly this audience (uBlock, Brave shields, NextDNS). So there is a
load timeout, an empty-shadow-root check, and a jup.ag link that is visible
at all times regardless of widget state. Do not remove them.

## Editing the site

Everything you'd want to change lives in the `CONFIG` block at the top of
`assets/app.js`:

- **`socials.telegram` / `socials.x`** — paste the URLs. A link left as `''` is
  simply not rendered, so the row never shows a dead button.
- **`memes`** — the gallery. Drop images in `assets/memes/`, then list them:
  ```js
  memes: [
    { src: 'assets/memes/eat-that-chart.jpg', caption: 'gonna eat that chart' },
    { src: 'assets/memes/tongue-holders.jpg', caption: 'diamond tongues' }
  ]
  ```
  The whole Memes section (and its nav link) stays hidden while the array is
  empty, so an unfinished gallery never leaves a hole in the page.
- **`burnWallet`** — the public address people can send $CUNA to in order to
  take it out of supply. While it's `''` the entire "send to the burn wallet"
  block stays hidden, and if it's set to something that isn't a valid base58
  address the block also stays hidden and logs a warning. That's deliberate:
  an absent feature is much better than a page telling people to send tokens
  to a wrong address. When it is set, the block shows the address with a copy
  button and the live balance sitting in it.
- **`lockProgram` / `lockMintOffset`** — how the locked total is read live. One
  `getProgramAccounts` call against the Jupiter Lock program, filtered by mint
  at byte 40, returns exactly this token's vesting escrows (29 of them today).
  Locked = Σ(cliff + per-period × periods − claimed), and the daily unlock rate
  comes from the escrows past their cliff. The decoded total agrees to the cent
  with summing the lock-owned token accounts, which is how the byte offsets
  were confirmed rather than guessed.
- **`lockedApprox`** — only a fallback, for RPCs that refuse
  `getProgramAccounts`. Shown with a `~` so a stale figure never masquerades as
  a live one. It will drift as locks vest, which is the whole reason the live
  read exists. The percentage beside it
  is computed against live supply, so it stays honest as supply burns down.
- **`launchSupply`** — the actual supply at launch (13,659,767,778.871345),
  used *only* to size the burn progress bar. It is a fixed historical
  constant, not live data; the supply it is measured against always is. Burn
  progress is `(launchSupply − liveSupply) / (launchSupply − burnGoal)`, and
  the bar's end labels are rendered from these two values so they cannot drift
  away from the maths.
- **`burnGoal`** — the 6.9B target.

The mint and pool addresses are also in `CONFIG`; the buy link, chart link and
Solscan link are all derived from the mint so there's one place to change it.

## Deploying on Railway

1. New Project → Deploy from GitHub repo → pick this repo.
2. Railway builds it with **Railpack**, which finds no `package.json` /
   `go.mod` / `requirements.txt` and so falls through to its **staticfile**
   provider. That sees `index.html` at the repo root, installs Caddy 2, and
   serves `.` on `$PORT`. No env vars, no start command, nothing to configure.
3. Push to the deploy branch → Railway redeploys.

**`nixpacks.toml` and `railway.json` in this repo are almost certainly inert**,
and it's worth knowing why before anyone edits them expecting an effect:

- Railway's Config-as-Code (`railway.json` / `railway.toml`) is deprecated, and
  **new services cannot opt into it** — existing legacy services still read it,
  and even those stop on 2026-12-01. A service created today never reads it.
  The file is schema-valid, it just isn't consulted.
- Railpack's config file is `railpack.json`. It does not read `nixpacks.toml`
  under any circumstances.

The deploy works regardless, because Railpack's zero-config behaviour for a
bare `index.html` is exactly what this site wants. Both files are kept only as
a fallback for a service explicitly pinned to the legacy Nixpacks builder, and
they can be deleted without changing anything.

Worth noting if you ever do switch to the legacy Nixpacks builder: its
`staticfile` provider serves with **nginx**, not Caddy, and the two produce
different headers.

### What Caddy serves, verified

All asset paths in `index.html` are relative, so serving from `.` is correct.
A local run of Railpack's exact generated Caddyfile confirmed the MIME types
that matter — `text/css` for the stylesheet, `text/javascript` for the script,
`image/jpeg` for the logo — with no `application/octet-stream` and no 404s.

Railpack's stock Caddyfile also emits a CSP. The page is compatible with it:
Google Fonts (`style-src https:`, `font-src https:`), the DexScreener and
Solana RPC calls and Jupiter's APIs (`connect-src https:`), and the plugin
script (`script-src https:`) are all permitted. Injected wallet providers are
exempt from page CSP. If you add anything that needs `blob:`, a Worker, or
`eval`, check the CSP first.

To attach the domain: Service → Settings → Networking → Custom Domain (or buy
it through Railway there), then follow the DNS instructions it shows.

## House rules for anything added here

- Static only. No secrets in the repo, ever — everything is public by design.
- Escape anything that comes from an API before it touches the page.
- No roadmap talk, no price predictions, no promised utility or perks, no
  financial advice. It's a meme coin and the copy should stay honest about it.
