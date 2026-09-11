/* A strip under the header pointing at the live drawing.
 *
 * The section nav is display:none below 980px, which is how the arcade ended
 * up unreachable on phones once already. A header icon is the other fix, but
 * the header is full and this is a weekend, not a permanent feature — so the
 * bar shows itself while the drawing is open and removes itself when it
 * closes, with no cleanup to remember.
 */
(function () {
  'use strict';

  var CLOSES_AT = Date.parse('2026-09-13T18:00:00Z');  /* Sun 13 Sep, 1 PM Central */
  var PRIZE = '0.25 SOL';

  function build() {
    if (Date.now() >= CLOSES_AT) return;

    /* Not on the drawing page itself, where it would just point at the page
       you are already reading. */
    if (/\/draw\.html$/.test(location.pathname)) return;

    var header = document.querySelector('header.nav');
    if (!header || !header.parentNode) return;

    var a = document.createElement('a');
    a.className = 'drawbar';
    a.href = 'draw.html';
    a.setAttribute('data-drawbar', '');

    var em = document.createElement('span');
    em.className = 'drawbar-emoji';
    em.setAttribute('aria-hidden', 'true');
    em.textContent = '🎟️';
    a.appendChild(em);

    var txt = document.createElement('span');
    txt.innerHTML = '';
    txt.textContent = 'Win ' + PRIZE + ' — enter the drawing';
    a.appendChild(txt);

    var go = document.createElement('span');
    go.className = 'drawbar-go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '→';
    a.appendChild(go);

    header.parentNode.insertBefore(a, header.nextSibling);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
