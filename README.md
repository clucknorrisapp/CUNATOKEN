# CUNALINGUS ($CUNA) — website

Single-page site for the $CUNA community. Static files only: no build step, no
backend, no secrets. Every number on the page is read live, client-side, from
public APIs.

```
index.html          main page: hero, burn tracker, bag checker, stats, community
buy.html            the Jupiter swap widget, on its own so it can breathe
safety.html         the long-form "is it safe?" answers
game.html           TONGUE RUSH, the arcade game
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

## TONGUE RUSH (game.html)

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

### Reaching the games

`.nav-links` is `display: none` below 980px, so for a while the arcade was
linked from **only** that row and was completely unreachable from a phone —
the games shipped and no phone visitor could find them. Two routes exist now,
both of which survive the breakpoint:

- A gamepad button in the header, inside `.nav-social`, which is the only part
  of the header that stays visible on mobile. It is on every page.
- An `#arcade` section in the homepage body, since scrolling is how the site
  is actually navigated on a phone.

The header button is hooked with `data-nav-play`, **not** `data-social`.
`app.js` sweeps `[data-social]` and hides any icon whose URL is missing from
`CONFIG.socials`, so the first version of this button was silently hidden on
exactly the three pages that load app.js — including the homepage it was
meant to fix. `scripts/`-free reachability is checked by a test that walks
every page at 375/390/1440 and asserts at least one *visible* link to a game,
which is what caught it.

### The games

Three of them, sharing one sprite atlas, one stylesheet and one input layer:

| Page | Game | What it is |
|---|---|---|
| `games.html` | — | The arcade index. All nav "Games" links point here. |
| `game.html` | TONGUE RUSH | Pac-Man. The maze, four chasers, courses. |
| `twister.html` | TONGUE TWISTER | Snake. The tongue grows; a chaser turns up at length 8. |
| `whack.html` | JEET WHACK | Whack-a-mole. 45 seconds, tap tacos, don't tap chasers. |
| `catcher.html` | CUNA CUMMIN' FOR YA | Catcher. Lips at the bottom, tacos rain down, chasers do too. |
| `tray.html` | TACO TRAY | Match-3. 7x7, five tile types, a 20-move budget. |

Three of the five share `assets/controls.js`. JEET WHACK and TACO TRAY are
pointer games and roll their own tap handling; both collapse the gutters on
touch, since an empty gutter is worse than no gutter.

Two things worth knowing about the later two:

- CUNA CUMMIN' FOR YA needs a *release* signal, which `controls.js` does not
  give it — that layer latches a direction after you let go, which is right
  for the grid games and wrong for a catcher. Rather than fork it, the game
  layers a keyup listener and a live-pointer count on top and zeroes the steer
  when the last one lifts. `onDir` is still the only thing that sets a
  direction, so the chevrons and d-pad arms light up as they do elsewhere.
- TACO TRAY dropped `ruggy` from its tile set. `jeet` and `ruggy` are the same
  ghost silhouette in two neighbouring warm hues, and at a 39px tile they read
  as one type with a colour wobble. Five types, each on a flat coloured plate,
  because three of the five are ghosts and the sprite alone is not a strong
  enough cue at that size.

`assets/controls.js` is the shared input layer and is the reason a second and
third game were cheap. It was **extracted rather than copied**: same-axis
reversal, re-anchoring a gesture at each committed turn and a resting hand not
stealing the stick all took real debugging, and three private copies would
have drifted apart the first time one of them was fixed. `game.js` was
migrated onto it rather than left on its own copy.

Every game sizes its board **from the viewport and the shell**, never
from the field. The field is a grid track that sizes to its content, so
measuring it and then setting the canvas inside it is a feedback loop — every
pass reads a slightly smaller box and writes a slightly smaller board. It
converges on the minimum tile size, and both boards were 120px squares on half
the devices tested before this was caught. Width is bounded by the *shell*
(whose width comes from the page, not the canvas); height by the viewport.

One more trap in the same family: `boardSide()` must not branch on
*orientation* alone. A 768px-wide desktop window is landscape by that test but
still reserves 2x240px of gutter, so handing the board the full shell width
sliced its right-hand columns off behind `overflow: hidden` with the page
never scrolling to give it away. Branch on a width media query and reserve the
gutter minimum; never measure a gutter, because those are `1fr` tracks and
measuring one re-creates the feedback loop.

`body.cuna-playing` hides the page furniture during immersive play. The shell
background is only 62% opaque, so anything left out of that list reads
straight through the board — `.cg-more` was added to the pages and not to the
list, and showed over the board on three of them. Anything new on a game page
goes in that rule.

**The art.** `assets/sprites.webp` is one atlas, nine 256px cells, generated
with Higgsfield (Recraft V4.1 at 2k) and cut out locally. The layout and cell
order are unchanged from the 144px version it replaced, so every game's cell
map kept working; only `SPR.cell` moved. It costs 114KB against the old 45KB,
which is the price of the games looking like this on a retina screen.

Three things about that pipeline are worth keeping:

- **The chasers differ by silhouette, not just hue.** The previous set had
  JEET and RUGGY as the same ghost shape in two neighbouring warm hues, and at
  a 39px match-3 tile they read as one type with a colour wobble. They are now
  an angular spiked one, a hooded one with a trailing tail, a melting goggled
  one and a folded-paper one. Colour is the last cue, not the only one.
- **The cutout is a distance-from-background key, not a hard matte.** Every
  subject is a glowing render on near-black, and the glow is part of the art;
  a threshold chops it into a hard rim. Alpha is driven by distance from the
  *measured* background — Recraft returns a slightly different near-black each
  time (17,7,12 / 38,24,27 / 2,0,3) so assuming pure black does not work.
- **Crop margin matters more than it sounds.** The first pass padded each
  sprite to 5.5% of its cell; because the old art ran cell-edge to cell-edge,
  every game suddenly drew its sprites smaller and JEET WHACK's tacos floated
  above their holes. Now 1.5%. `game.js` also drops its pellet from 0.92 to
  0.78 of a tile, because the tighter crop had adjacent tacos almost touching
  and the corridors stopped reading as corridors.

Two failures worth remembering: a dark violet subject on a dark plum UI is
invisible no matter how good the render (RUGGY had to be regenerated with
"brightly lit, NOT dark" and now measures +58 luminance over the background,
against JEET's +51), and a chomp pair has to be generated at the same framing
or the two frames pop between sizes.

**Neon pass.** Every board carries the same treatment so the five games read
as one arcade: glowing wall edges in TONGUE RUSH (plus a sparkle layer on the
tacos), a neon grid and a bloomed tongue in TONGUE TWISTER, lit hole rims in
JEET WHACK, per-colour glow lips on the TACO TRAY plates, and neon rails with
a hot floor line in CUNA CUMMIN' FOR YA.

The rule throughout is **never `shadowBlur` in a frame**. It is used once, in
TONGUE RUSH's prerendered maze, which is rebuilt only on layout. Everywhere
else a glow is faked with stacked wide low-alpha strokes under
`globalCompositeOperation = 'lighter'`, which costs almost nothing.

That still was not enough on its own, and measuring caught two things:

- TACO TRAY's glow ring was drawn live on all 49 tiles, which cost a whole
  extra frame (33ms → 50ms at 4x CPU throttle). Plates are now baked to one
  canvas per type per state on layout, so a tile costs a single `drawImage`.
- CUNA CUMMIN' FOR YA was rebuilding a full-board radial gradient every frame.
  Caching the gradient *object* was not enough — the per-pixel fill was the
  cost, and an empty board still measured 33ms. The glow is baked to a bitmap
  and blitted.

Both games ended up roughly **twice as fast as before the neon pass**: all
five now hold a 16.7ms median at 4x CPU throttle, where catcher and tray sat
at 33.3ms beforehand. If you add an effect here, throttle the CPU 4x and
measure — the difference between a cheap effect and an expensive one is not
visible at desk speed.

JEET WHACK draws its targets at ~190px. The maze pellet sprite is drawn at
~16px in TONGUE RUSH and has no face, so blown up it is a featureless cream
dome; the tap game uses the detailed taco for both target kinds and separates
them by size and a glow instead.

**Controls.** Desktop: arrows or WASD, P to pause, M to mute, Space/Enter to
start. Touch: a **d-pad cross in one gutter and a joystick in the other**,
both live at the same time, plus swipe on the playfield. Nobody has to choose
before playing — you reach for whichever instrument you prefer and it works.
The `⇄` chip on the start card swaps which side each is on and remembers it
(`cuna_ctl_side`); that is handedness only, never a mode gate.

Both gutters being permanently live is the design, not an oversight. The
scheme it replaced had a single stick that migrated to whichever gutter you
pressed, which is what made it unusable on a tablet: an iPad is held
two-handed, the empty gutter is a large dead area directly under the holding
hand, and any incidental contact there dragged the stick across and took over
steering from the thumb mid-drag. With both sides live and neither moving,
there is no "active" side to steal, and a stationary touch simply never
exceeds the dead zone, so a resting hand commits nothing.

The two gutters run the *same* handler; only what is drawn differs, and
`armAt` returns -1 on the stick side so there are no invisible tap targets.

The stick is **fixed by default** (`cuna_stick_float`, off): the ring holds
its printed spot and is driven from its own centre, the way a physical one
is, so its position becomes muscle memory instead of being re-found every
time. The grab radius is `r * 1.35` — generous, so "near enough" counts —
and a press elsewhere in that gutter is not dead: it falls through to a plain
swipe from wherever the thumb landed, so a miss still steers. The `STICK:`
chip switches it to FOLLOWS, where the ring re-centres under the thumb on
press and springs home on release. `S.ringDriven` records which of the two
happened, so a swipe that missed the ring does not light it up or throw its
nub. On the pad side the ring is hidden until a drag actually starts.

**Keyboard.** Arrows or WASD steer, and also start the run from the attract
screen or resume from pause. Space/Enter starts and restarts, P pauses, M
mutes, Escape pauses (and from paused or game-over, leaves for the site).
Modifier combos are ignored so browser shortcuts still work, and `shellEngaged()`
means the keys are only claimed while the game is actually on screen — reading
the footer does not find space and the arrows hijacked. Keyboard input goes
through `setDir`, so it lights both crosses just like touch does. A
coarse-pointer device never flips to the desktop layout even with a keyboard
attached (`setInputMode` refuses it), so an iPad with a Magic Keyboard keeps
its touch controls *and* takes keys.

The cross is mostly an affordance. A bare swipe surface tests perfectly and
still fails in the wild, because nothing tells anyone it is there.

The options row is pinned to the bottom of the overlay rather than placed in
the card. In the card it sat within 5px of the dead centre of an iPad screen,
which is exactly where a thumb lands to start a game, so tapping to play
flipped your controls instead. Anything interactive on the attract overlay
also needs `pointer-events: auto`: that overlay is `cg-pass` so taps fall
through to the field to start the run, and a button on it is otherwise inert.
`fieldDown` bails on any `[data-act]` target for the same reason — without it
the same touch that hits a button also starts the game underneath it.

Two layout traps in that row: it spans `left/right` rather than centring with
`left: 50%` + translate, because anchoring at 50% leaves only half the
container's width to grow into and the chips wrapped to a second row on a
375px screen despite fitting easily on one. And because the row is absolutely
positioned it takes no part in centring the card above it, so
`.cg-card.cg-attract` carries a bottom margin to reserve the space — without
it the card and the chips overlapped by 9px on the shortest field.

Four things about the input are easy to break and worth knowing:

- **Hysteresis applies across axes only.** A turn from LEFT to UP must beat
  the direction already held (`TURN_MARGIN` ratio *and* `TURN_MIN_PX`
  absolute) so it does not machine-gun near 45 degrees. But a reversal along
  the *same* axis is not a competition — the sign flipped, and that is all —
  so it commits immediately. Weighing a reversal against its own axis makes
  `held` and `rival` the same number, the test can never pass, and the
  direction can never reverse: on the old build you could push up, drag all
  the way back down, and it stayed stubbornly UP.
- **Re-anchor on a committed change, and only then.** `commitVec` returns
  whether the direction actually changed; the caller moves the gesture origin
  to that point when it did. Re-anchoring every move resets the evidence each
  frame so no vector can ever grow enough to win a turn; never re-anchoring
  leaves the first leg's displacement standing forever so no *second* turn in
  a gesture can beat it. Either mistake looks like "chained swipes are
  ignored".
- The direction vector is measured from **where the thumb landed** (`ox/oy`),
  never from the ring's drawn centre. The ring is drawn under the thumb on
  drag and is a readout, not the origin.
- The playfield swipe deliberately has **no dead wedge**. Requiring one axis
  to beat the other by 1.5x discarded 22.6 degrees on each diagonal — 90
  degrees of the circle, a quarter of every possible swipe, silently. A
  four-way game has no diagonals to disambiguate; the dominant axis wins and
  hysteresis handles the rest.
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
