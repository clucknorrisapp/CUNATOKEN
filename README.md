# CUNALINGUS ($CUNA) — website

Single-page site for the $CUNA community. Static files only: no build step, no
backend, no secrets. Every number on the page is read live, client-side, from
public APIs.

```
index.html          main page: hero, burn tracker, bag checker, stats, community
buy.html            the Jupiter swap widget, on its own so it can breathe
safety.html         the long-form "is it safe?" answers
game.html           MUNCHALINGUS, the arcade game
assets/game.css     game-only styles (loaded after styles.css)
assets/game.js      the whole game in one IIFE
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

`app.js` quotes `lite-api.jup.ag/swap/v1/quote` itself and prints one line
under the widget for whatever amount is typed — amber past
`CONFIG.jupiter.warnPct`, red past `badPct`. In a pool this thin that number is
the whole story: a 2 SOL buy currently costs about 15%.

Jupiter's widget does have a price-impact row of its own, but it only appears
by accident. Ultra returns `priceImpactPct` as a *negative* fraction, and the
row is gated on `Number(formatted) < 0.01` — true for a negative in
English-style locales, so the row is dropped; `NaN` and therefore false in
comma-decimal locales, so it renders, as a double negative like `--8,95%`.
Measured across 29 locales: 8 hide it, 21 show it garbled. So an
English-speaking visitor gets no impact figure from Jupiter at all, and most
other visitors get a broken one. Either way the host page printing a clean
number is worth it. Do not write copy claiming Jupiter never shows it — that is
only true for some visitors, and it is a bug on a rolling URL that could be
fixed at any time.

There used to be a table of impact-at-various-sizes above the widget too. It
was removed deliberately: it read like a trading terminal on a meme coin site.

Note `quote-api.jup.ag/v6` is dead (502) — use `lite-api.jup.ag/swap/v1/quote`.

### The failure paths are not optional

The plugin can die silently in two independent ways, and `init()` resolves in
both. Checking only one of them still ships an empty box.

1. It fetches its stylesheets with `Promise.all`, one of which is from Google
   Fonts. Any single rejection discards all of them and the shadow root is left
   essentially empty. Blocking `fonts.googleapis.com` is common among exactly
   this audience — uBlock, Brave shields, NextDNS.
2. Its loader injects a second ~800KB script and neither awaits nor catches it.
   If that is blocked — plausible for a large script on a crypto domain — the
   shadow root fills in and looks healthy, the box is a full 560px tall, and
   the portal inside stays empty forever while the loader polls for a global
   that never arrives.

So `widgetLooksEmpty()` requires shadow content **and**
`window.JupiterRenderer.RenderJupiter`. That combined predicate was measured
correct in all three states (healthy, fonts blocked, chunk blocked); either
check alone passes one of the two failures. It polls rather than sampling once,
so a slow connection fetching 800KB isn't mistaken for a dead widget, and a
placeholder sits in the container meanwhile so the wait doesn't look like
breakage.

There is also a load timeout and a jup.ag link visible at all times regardless
of widget state. Do not remove any of it.

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

## MUNCHALINGUS (game.html)

A Pac-Man homage. The chart is the maze, the player is the lips-and-tongue from
the coin, the pellets are tiny tacos, the power-up is a loaded taco, and the
four chasers are JEET
(charges straight at you, faster as the book empties), RUGGY (aims four tiles
ahead of you), FUDD (targets off JEET's position, so he is harmless alone and
lethal in a pincer) and PAPER (chases until he is close, then bottles it).
Score is CALORIES, never tokens — nothing in the game earns anyone anything,
and the copy is written to keep it that way.

Canvas 2D, no libraries, no build step.

### The sprite atlas

`assets/sprites.webp` is one 720x288 WebP holding nine 144px cells — player
mouth open, mouth closed, power taco, pellet taco, the four chasers, and the
frightened ghost. 44KB, one request, generated art rather than canvas paths.
`SPR.map` in `game.js` is the cell lookup; `drawSprite()` blits one cell with
optional rotation and horizontal mirror.

Note `kind` on a chaser is a numeric index, not a name — `CH_SPRITE` maps it to
the atlas cell. Passing `c.kind` straight to `drawSprite` silently falls
through to the path art, which looks like nothing happened.

Pellets are baked into an offscreen layer (`pelletCan`) on the existing
`pelletDirty` flag, so 200-odd tacos cost one `drawImage` a frame rather than
200. Energizers pulse, so those are drawn individually — there are only four.

**Every sprite draw falls back to the path version.** `drawSprite` returns
false when the atlas has not loaded, and each call site draws the canvas art
instead. A browser without WebP, a blocked request, a 404 — the game still
plays, just hand-drawn instead of illustrated. This is tested by aborting the
atlas request; do not remove the fallbacks.

The path art below is therefore still live code, not legacy:

- `drawMouth` is the player: a dark mouth cavity, then the tongue, then two
  fat lip halves hinged at the back corner and rotated apart by `open` — the
  same trick that makes any Pac-Man read as a Pac-Man. Gradient body, white
  teeth clipped inside the upper lip only, and a single soft specular streak
  per lip.

  Three numbers here were tuned by looking at it on screen and are easy to
  wreck: the lips are deliberately FAT (peak bulge 0.76), because thin lens
  shapes leave the character mostly dark cavity at maze scale; the highlights
  sit at 0.34 alpha, because at 0.72 they wash the lips to a pale wedge; and
  the tongue is a lighter pink than the lips, because at the same pink the two
  merge into one blob.

- Pellets are half-disc tacos — shell gradient, filling band, one offset
  garnish speck — batched into three Path2Ds, so the whole board is three
  fills a frame however many are left. Detail drops by size: no filling under
  13px, no speck under 18px, no outline under 19px. The speck is deliberately
  a single offset dot: a symmetrical pair above the filling stripe reads as
  two eyes over a mouth and turns every pellet into a tiny face.

- `drawLoadedTaco` is the energizer — the winking taco character from the
  brand art, with a loaded filling edge, shell speckles and a face. Only four
  on the board, so it can afford detail the pellets cannot. `assets/game.js` is one IIFE and uses modern syntax, unlike
`assets/app.js` which is deliberately ES5-style.

**Controls.** Desktop: arrows or WASD, P to pause, M to mute, Space/Enter to
start. Mobile: twin virtual joysticks, one in each gutter, and **either one
drives** — so left- and right-handers are both served and nobody reaches across
the screen. A swipe on the playfield works too.

Two things about the sticks are easy to break and worth knowing:

- The direction vector is measured from **where the thumb landed** (`ox/oy`),
  not from the ring's drawn centre (`cx/cy`). The ring is clamped so it never
  renders half outside the gutter; measuring from the clamped centre meant a
  thumb resting low — where thumbs actually rest — read as already pushed down
  before it moved.
- The portrait grid caps the thumb deck and centres the field in what is left.
  The maze is width-bound in portrait, so leftover height is unavoidable slack;
  the cap stops it pooling into a dead band between the maze and the sticks.
  `layout()`'s `deck` constant must stay in step with the CSS deck row, or the
  canvas can be sized taller than the grid leaves room for.

A coarse-pointer device never switches to the desktop layout, even if a
keyboard is attached — keyboard input works in touch layout anyway, and the
three-column grid at 390px used to shove the maze off the side.

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
