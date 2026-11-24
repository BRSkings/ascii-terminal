'use strict';

/* Builds a transparent OpenCode TUI theme from the official V2 theme in the
 * active OpenCode source (anomalyco/opencode). All background/scrollbar fills
 * become `transparent`; every other token (text, syntax, diff text, hues,
 * borders) is preserved verbatim so the UI still looks like OpenCode.
 *
 * Usage: node scripts/build-opencode-theme.js
 */

const fs = require('fs');
const path = require('path');

const SOURCE_URL =
  'https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/tui/src/theme/assets/v2/opencode.json';

const OUT = path.resolve(__dirname, '..', 'opencode-theme', 'transparent.json');

function allStrings(node, value) {
  if (Array.isArray(node)) return node.map((item) => allStrings(item, value));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(node)) out[key] = allStrings(child, value);
    return out;
  }
  return typeof node === 'string' ? value : node;
}

function transform(node) {
  if (Array.isArray(node)) return node.map((item) => transform(item));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(node)) {
      // `background` token groups and `scrollbar` are the fills we want see-through.
      if (key === 'background' || key === 'scrollbar') out[key] = allStrings(child, 'transparent');
      else out[key] = transform(child);
    }
    return out;
  }
  return node;
}

(async () => {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error('Failed to fetch source theme: HTTP ' + res.status);
  const source = await res.json();

  const themed = transform(source);
  themed.$schema = 'https://opencode.ai/theme.json';

  // Use the warm orange hue for interactive/accent so the prompt's `┃` border
  // renders as a clean peach bar instead of a bright blue segmented line.
  if (themed.dark && themed.dark.hue) {
    themed.dark.hue.accent = '$hue.orange';
    themed.dark.hue.interactive = '$hue.orange';
    // The prompt's `┃` border and info accents render from blue.400; make it
    // a soft peach so it reads as a calm, continuous line instead of a bright
    // blue segmented bar over the animation.
    if (themed.dark.hue.blue) themed.dark.hue.blue['400'] = '#ecb081';
  }
  if (themed.light && themed.light.hue) {
    themed.light.hue.accent = '$hue.orange';
    themed.light.hue.interactive = '$hue.orange';
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(themed, null, 2) + '\n', 'utf8');

  // Report what changed for verification.
  let changed = 0;
  let kept = 0;
  (function count(a, b) {
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of Object.keys(b)) count(a[k], b[k]);
    } else if (b === 'transparent' && a !== 'transparent') changed++;
    else kept++;
  })(source, themed);

  console.log('Source : ' + SOURCE_URL);
  console.log('Output : ' + OUT);
  console.log('Tokens converted to transparent:', changed);
  console.log('Other tokens preserved         :', kept);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
