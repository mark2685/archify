import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Hadrian preset's seven semantic categories must read as seven different
// boxes, by fill as well as by outline, in both themes (FORK.md, "Colour
// mapping"). Contrast alone does not guarantee that: the first palette passed
// every brand guard while backend and database fills sat 0.9 CIE76 ΔE apart in
// light mode, below what anyone can see. This test resolves every category's
// fill and outline from viewer/hadrian.css and measures each pair in CIELAB.

// ARCHIFY_HADRIAN_CSS points the same checks at a mutated copy.
const cssPath = process.env.ARCHIFY_HADRIAN_CSS || fileURLToPath(new URL('../viewer/hadrian.css', import.meta.url));
const source = fs.readFileSync(cssPath, 'utf8');

const CATEGORIES = ['frontend', 'backend', 'database', 'messagebus', 'security', 'cloud', 'external'];
// CIE76 ΔE floors. About 2-3 is a just-noticeable difference; 8 reads as a
// different tint at a glance, and outlines carry the category name, so they get more.
const FLOOR = { fill: 8, stroke: 15 };
// Pairs that share one hub family on purpose get a lower floor. Each needs a reason.
const SHARED_FAMILY = new Map([
  // The hub has five chromatic families for seven categories, so cloud and
  // external are both grays one step apart; their sigils and cloud's dashed
  // frame separate them. The floor still keeps them from collapsing into one.
  ['cloud/external', { fill: 3, stroke: 10 }],
]);

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s+/g, ',\\s*');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} block exists`);
  const out = new Map();
  for (const declaration of match[1].split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) out.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return out;
}

const linear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
// sRGB (D65) to CIELAB.
function lab(value) {
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(value.slice(i, i + 2), 16)));
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// Every category pair's fill and outline distance in each theme.
export function categoryDistances(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = block(css, ':root, [data-preset="hadrian"]');
  const distances = [];
  for (const theme of ['dark', 'light']) {
    const declarations = block(css, `[data-preset="hadrian"][data-theme="${theme}"]`);
    const resolve = (name, depth = 0) => {
      assert.ok(depth < 8, `${name}: variable chain too deep`);
      const value = declarations.get(name) ?? tokens.get(name);
      assert.ok(value, `${theme}: ${name} is defined`);
      const reference = value.match(/^var\((--[a-z0-9-]+)\)$/);
      if (reference) return resolve(reference[1], depth + 1);
      assert.match(value, /^#[0-9a-f]{6}$/i, `${theme}: ${name} resolves to a hex colour`);
      return value.toLowerCase();
    };
    for (const [i, a] of CATEGORIES.entries()) {
      for (const b of CATEGORIES.slice(i + 1)) {
        for (const part of ['fill', 'stroke']) {
          distances.push({ theme, pair: `${a}/${b}`, part, deltaE: deltaE(resolve(`--${a}-${part}`), resolve(`--${b}-${part}`)) });
        }
      }
    }
  }
  return distances;
}

export function violations(raw) {
  return categoryDistances(raw)
    .filter(({ pair, part, deltaE: distance }) => distance < (SHARED_FAMILY.get(pair)?.[part] ?? FLOOR[part]))
    .map(({ theme, pair, part, deltaE: distance }) => `${theme} ${part} ${pair}: ΔE ${distance.toFixed(1)} < ${SHARED_FAMILY.get(pair)?.[part] ?? FLOOR[part]}`);
}

test('every pair of category fills and outlines is distinguishable in both themes', () => {
  const distances = categoryDistances(source);
  assert.equal(distances.length, 2 * 2 * (CATEGORIES.length * (CATEGORIES.length - 1)) / 2, 'every pair in every theme is measured');
  for (const pair of SHARED_FAMILY.keys()) assert.ok(distances.some((d) => d.pair === pair), `shared-family entry ${pair} names a measured pair`);
  assert.deepEqual(violations(source), []);
});

test('the distinguishability guard rejects colliding categories', () => {
  // A deliberate violation: light database boxes painted with the backend
  // fill, and dark database outlines drawn in the backend green.
  const collided = source
    .replace(/(\[data-theme="light"\][^{]*\{[^}]*--database-fill:\s*)var\([^)]+\)/, '$1var(--backend-fill)')
    .replace(/(\[data-theme="dark"\][^{]*\{[^}]*--database-stroke:\s*)var\([^)]+\)/, '$1var(--color-status-green)');
  assert.notEqual(collided, source, 'the mutation applied');
  const found = violations(collided);
  assert.ok(found.some((line) => line.startsWith('light fill backend/database: ΔE 0.0')), found.join('\n'));
  assert.ok(found.some((line) => line.startsWith('dark stroke backend/database: ΔE 0.0')), found.join('\n'));
});
