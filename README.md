# CUNALINGUS ($CUNA) — website

Single-page site for the $CUNA community. Static files only: no build step, no
backend, no secrets. Every number on the page is read live, client-side, from
public APIs.

```
index.html          the whole page
assets/styles.css   sticker-book styles
assets/app.js       config + live data + interactions
assets/logo.jpg     the coin art
assets/memes/       meme gallery images (drop files here)
nixpacks.toml       tells Railway to serve this as a static site
railway.json        Railway build/deploy settings
```

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
| A connected wallet's $CUNA balance | Solana JSON-RPC `getTokenAccountsByOwner` | Same endpoints; read-only, see below |

Data refreshes every 30 seconds while the tab is visible. If both sources fail
the page keeps its last values and says so instead of showing zeros.

Nothing fetched from an API is ever inserted as HTML — every value goes through
`textContent` after being coerced to a number, so a hostile API response can't
inject markup.

## The wallet connect is read-only, and must stay that way

The "Check your bag" section connects a Solana wallet purely to look up a
balance. The **only** wallet methods `app.js` ever calls are `connect()` and
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
- **`lockedApprox`** — amount locked in Jupiter locks. The percentage beside it
  is computed against live supply, so it stays honest as supply burns down.
- **`launchSupply`** — a fixed launch-time constant (10B) used *only* to size
  the burn progress bar. It is not live data. Burn progress is
  `(launchSupply − liveSupply) / (launchSupply − burnGoal)`.
- **`burnGoal`** — the 6.9B target.

The mint and pool addresses are also in `CONFIG`; the buy link, chart link and
Solscan link are all derived from the mint so there's one place to change it.

## Deploying on Railway

The repo is already set up as a Railway static site:

1. New Project → Deploy from GitHub repo → pick this repo.
2. Railway detects `nixpacks.toml`, builds with the `staticfile` provider and
   serves the repo root with Caddy on `$PORT`. No env vars, no start command.
3. Push to the deploy branch → Railway redeploys.

To attach the domain: Service → Settings → Networking → Custom Domain (or buy
it through Railway there), then follow the DNS instructions it shows.

## House rules for anything added here

- Static only. No secrets in the repo, ever — everything is public by design.
- Escape anything that comes from an API before it touches the page.
- No roadmap talk, no price predictions, no promised utility or perks, no
  financial advice. It's a meme coin and the copy should stay honest about it.
