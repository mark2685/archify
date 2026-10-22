import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Hadrian preset may use only Hadrian design-hub colours, square corners,
// hairline edges and no shadows or glows (FORK.md, "Brand rules"). Nothing in
// CSS enforces that, so this test reads viewer/hadrian.css directly.

// ARCHIFY_HADRIAN_CSS lets the proof below point the same checks at a mutated copy.
const cssPath = process.env.ARCHIFY_HADRIAN_CSS || fileURLToPath(new URL('../viewer/hadrian.css', import.meta.url));
const raw = fs.readFileSync(cssPath, 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

// Hadrian-MTV/design src/index.css @theme and registry-seed.sql colour records.
export const HUB_LITERALS = new Set([
  '#002548', '#13497d', '#70b8fd', '#f3a000', '#889199', '#817d51', '#ffffff', '#000000',
  '#062e54', '#0b3a66',
  '#e2f1ff', '#a2cef7', '#3f9efb', '#1880e5', '#0258ab', '#023c74',
  '#fff4de', '#ffe5b2', '#fed077', '#ffb830', '#ca8604', '#8c5d01', '#664401', '#3d2800',
  '#f4f6f9', '#e2e7ea', '#c6cacd', '#a5aeb6', '#757a7f', '#5c6167', '#414448', '#262c32',
  '#9bc08f', '#e79089', '#e0413a', '#2ed87e',
]);

function rules(source) {
  const out = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      out.push({ selector, property: declaration.slice(0, colon).trim(), value: declaration.slice(colon + 1).trim() });
    }
  }
  return out;
}
const declarations = rules(css);
assert.ok(declarations.length > 100, 'hadrian.css parsed into its declarations');

const tokens = new Map();
for (const { selector, property, value } of declarations) {
  if (property.startsWith('--color-')) {
    assert.equal(selector, ':root, [data-preset="hadrian"]', `${property} must be declared in the token block`);
    assert.ok(!tokens.has(property), `${property} is declared twice`);
    tokens.set(property, value.toLowerCase());
  }
}

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const mix = (a, pa, b) => a.map((c, i) => Math.round(c * pa + b[i] * (1 - pa)));

// `/* derived: <token> <p>% over <token> */` beside a token records how it was
// computed from hub literals; raw keeps the comments the parser stripped.
const derivations = new Map();
for (const line of raw.split('\n')) {
  const match = line.match(/^\s*(--color-[a-z0-9-]+):\s*(#[0-9a-f]{6});\s*\/\*\s*derived:\s*([a-z0-9-]+)\s+(\d+)%\s+over\s+([a-z0-9-]+)\s*\*\//i);
  if (match) derivations.set(match[1], { hex: match[2].toLowerCase(), top: `--color-${match[3]}`, percent: Number(match[4]), under: `--color-${match[5]}` });
}

test('every --color-* token is a hub literal or a recorded mix of hub literals', () => {
  assert.ok(tokens.size >= 30);
  for (const [name, value] of tokens) {
    assert.match(value, /^#[0-9a-f]{6}$/, `${name} must be one six-digit hex literal`);
    if (HUB_LITERALS.has(value)) continue;
    const derivation = derivations.get(name);
    assert.ok(derivation, `${name} (${value}) is neither a hub literal nor annotated as derived`);
    const top = tokens.get(derivation.top);
    const under = tokens.get(derivation.under);
    assert.ok(top && under, `${name}: derivation names unknown tokens ${derivation.top} / ${derivation.under}`);
    const expected = toHex(mix(hex(top), derivation.percent / 100, hex(under)));
    assert.equal(value, expected, `${name} must equal ${derivation.top} ${derivation.percent}% over ${derivation.under}`);
  }
  assert.ok([...tokens.values()].filter((value) => HUB_LITERALS.has(value)).length >= 20, 'the palette carries the hub literals');
});

test('derived tokens are built from hub literals, never from other derived tokens two levels deep', () => {
  for (const [name, { top, under }] of derivations) {
    for (const source of [top, under]) {
      const value = tokens.get(source);
      assert.ok(HUB_LITERALS.has(value) || derivations.has(source), `${name}: ${source} is not a known token`);
      if (derivations.has(source)) {
        const { top: t2, under: u2 } = derivations.get(source);
        assert.ok(HUB_LITERALS.has(tokens.get(t2)) && HUB_LITERALS.has(tokens.get(u2)), `${name}: ${source} must itself derive directly from hub literals`);
      }
    }
  }
});

test('colour reaches every declaration only through tokens', () => {
  const paints = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|color))?|outline(-color)?|fill|stroke|text-decoration(-color)?|--(?!color-|hadrian-font)[a-z0-9-]+)$/;
  const offenders = [];
  for (const { selector, property, value } of declarations) {
    if (property.startsWith('--color-') || property.startsWith('--hadrian-font')) continue;
    if (!paints.test(property)) continue;
    if (/#[0-9a-f]{3,8}\b/i.test(value)) offenders.push(`${selector} { ${property}: ${value} } uses a hex literal`);
    if (/\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\(/.test(value)) offenders.push(`${selector} { ${property}: ${value} } uses a colour function`);
    const residue = value
      .replace(/var\(--[a-z0-9-]+\)/g, '')
      .replace(/!important|transparent|none|inherit|solid|dotted|dashed|radial-gradient|circle|at|\d+(\.\d+)?(px|rem|em|%)?/g, '');
    if (/[a-z]/i.test(residue)) offenders.push(`${selector} { ${property}: ${value} } names a colour that is not a token`);
  }
  assert.deepEqual(offenders, []);
});

test('Stratosphere Blue is only the focus ring on navy and gold means only the message bus', () => {
  const strato = declarations.filter(({ value }) => value.includes('var(--color-strato)'));
  assert.deepEqual(strato.map(({ selector, property }) => `${selector} ${property}`), ['[data-preset="hadrian"][data-theme="dark"] --hadrian-focus']);
  const gold = declarations.filter(({ property, value }) => !property.startsWith('--color-') && /var\(--color-gold(-\d+)?\)/.test(value));
  assert.ok(gold.length >= 2);
  for (const { property } of gold) assert.match(property, /^--messagebus-/, `gold must only colour the message bus, found ${property}`);
  const goldDerived = [...derivations].filter(([, { top, under }]) => /^--color-gold/.test(top) || /^--color-gold/.test(under)).map(([name]) => name);
  assert.deepEqual(goldDerived, ['--color-fill-messagebus-navy']);
});

test('the preset squares every corner and casts no shadow or glow', () => {
  const radii = declarations.filter(({ property }) => property === 'border-radius' || property === 'rx' || property === 'ry');
  assert.ok(radii.length >= 3);
  for (const { selector, property, value } of radii) assert.match(value, /^0( !important)?$/, `${selector} { ${property}: ${value} }`);
  for (const { selector, property, value } of declarations.filter(({ property }) => /^(box-shadow|text-shadow|filter|backdrop-filter|-webkit-backdrop-filter)$/.test(property))) {
    assert.match(value, /^none( !important)?$/, `${selector} { ${property}: ${value} }`);
  }
  assert.ok(declarations.some(({ selector, property, value }) => selector.startsWith('html[data-preset="hadrian"] *') && property === 'border-radius' && value === '0 !important'));
  assert.ok(declarations.some(({ selector, property, value }) => selector.startsWith('html[data-preset="hadrian"] *') && property === 'box-shadow' && value === 'none !important'));
  assert.ok(declarations.some(({ selector, property, value }) => selector === 'svg[data-preset="hadrian"] rect' && property === 'rx' && value === '0'));
  assert.ok(declarations.some(({ selector, property, value }) => selector === 'svg[data-preset="hadrian"] *' && property === 'filter' && value === 'none !important'));
  for (const { selector, property, value } of declarations.filter(({ property }) => property === 'border-width')) {
    assert.equal(value, '1px', `${selector} { ${property}: ${value} }`);
  }
});

test('the diagram keeps JetBrains Mono while the chrome uses Hadrian faces', () => {
  const fonts = declarations.filter(({ property }) => property === 'font-family');
  assert.ok(fonts.length >= 2);
  for (const { selector, value } of fonts) {
    assert.ok(selector.startsWith('html[data-preset="hadrian"]'), `${selector}: fonts change only on the page chrome, never on svg`);
    assert.match(value, /^var\(--hadrian-font-(sans|mono)\)$/);
  }
  assert.match(tokens.get('--hadrian-font-sans') || declarations.find(({ property }) => property === '--hadrian-font-sans').value, /^"Sohne", "Inter", system-ui/);
  assert.match(declarations.find(({ property }) => property === '--hadrian-font-mono').value, /^"Sohne Mono", ui-monospace/);
  assert.ok(!css.includes('JetBrains'), 'the preset never redeclares the diagram font');
});
