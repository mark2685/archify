import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRAST_SOURCE, openBrowser, renderDefaultExamples, scratchDirectory, skipWithoutChrome } from './helpers/hadrian-browser.mjs';

// Text in the Hadrian preset reaches WCAG 2.2 SC 1.4.3's 4.5:1 floor on every
// surface it can sit on, in both themes. The static half resolves the token
// pairs from viewer/hadrian.css; the browser half measures rendered HTML and
// SVG text against the backgrounds Chrome actually paints behind them.

const FLOOR = 4.5;
const cssPath = process.env.ARCHIFY_HADRIAN_CSS || fileURLToPath(new URL('../viewer/hadrian.css', import.meta.url));
const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s+/g, ',\\s*')}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} block exists`);
  const out = new Map();
  for (const declaration of match[1].split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) out.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return out;
}
const tokens = block(':root, [data-preset="hadrian"]');
const themes = {
  dark: block('[data-preset="hadrian"][data-theme="dark"]'),
  light: block('[data-preset="hadrian"][data-theme="light"]'),
};

function resolve(value, theme, depth = 0) {
  assert.ok(depth < 8, `variable chain too deep: ${value}`);
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/);
  if (!reference) return value;
  const next = themes[theme].get(reference[1]) ?? tokens.get(reference[1]);
  assert.ok(next, `${reference[1]} is defined`);
  return resolve(next, theme, depth + 1);
}
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const colour = (name, theme) => {
  const value = resolve(`var(${name})`, theme);
  assert.match(value, /^#[0-9a-f]{6}$/i, `${name} resolves to a hex colour in ${theme}`);
  return hex(value);
};

const CATEGORIES = ['frontend', 'backend', 'database', 'messagebus', 'security', 'cloud', 'external'];
// Every token the Viewer or renderers use as text ink: page and SVG copy,
// relationship labels (--arrow), emphasis labels, and the category inks that
// colour node tags, legend text and boundary labels.
const INKS = ['--text', '--text-muted', '--text-dim', '--text-faint', '--toolbar-text', '--arrow', '--arrow-emphasis',
  ...CATEGORIES.map((category) => `--${category}-stroke`)];
// Every surface such text can sit on.
const SURFACES = ['--bg', '--panel', '--mask', '--lane-fill', '--toolbar-bg', '--toolbar-menu-bg', '--toolbar-hover',
  ...CATEGORIES.map((category) => `--${category}-fill`)];

for (const theme of ['dark', 'light']) {
  test(`${theme}: every ink clears ${FLOOR}:1 on every surface`, () => {
    const failures = [];
    for (const ink of INKS) {
      for (const surface of SURFACES) {
        // Toolbar ink sits only on toolbar surfaces; category inks sit on the
        // page surfaces and on their own node fill.
        if (ink === '--toolbar-text' && !surface.startsWith('--toolbar')) continue;
        if (ink.endsWith('-stroke') && surface.endsWith('-fill') && surface !== ink.replace('-stroke', '-fill')) continue;
        const ratio = contrast(colour(ink, theme), colour(surface, theme));
        if (ratio < FLOOR) failures.push(`${ink} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(failures, []);
  });
}

test('the focus ring is visible against both grounds', () => {
  assert.ok(contrast(colour('--hadrian-focus', 'dark'), colour('--bg', 'dark')) >= 3, 'Stratosphere Blue on navy');
  assert.ok(contrast(colour('--hadrian-focus', 'light'), colour('--bg', 'light')) >= 3, 'blue-600 on gray-100');
});

// Browser half: sample the rendered text. For SVG text the background is the
// node card or label plate inside the same group, otherwise the diagram panel;
// for HTML text it is the nearest ancestor with an opaque background.
const TEXT_PROBE = `(() => {
  ${CONTRAST_SOURCE}
  const failures = [];
  let sampled = 0;
  const panel = document.querySelector('.diagram-container');
  const panelBg = rgba(getComputedStyle(panel).backgroundColor);
  const svg = panel.querySelector(':scope > svg');
  const describe = (element) => element.tagName.toLowerCase() + '.' + (element.getAttribute('class') || '') + ' "' + (element.textContent || '').trim().slice(0, 32) + '"';
  for (const text of svg.querySelectorAll('text')) {
    const style = getComputedStyle(text);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    if (!text.textContent.trim()) continue;
    let node = text;
    while (node && node !== svg && !(node.matches('g[data-node-id]') || node.matches('g[data-edge-from]') || node.matches('[data-legend]'))) node = node.parentElement;
    let background = panelBg;
    if (node && node !== svg) {
      const plate = node.matches('g[data-node-id]')
        ? node.querySelector(':scope > rect:not(.c-mask), :scope > circle, :scope > polygon')
        : node.querySelector(':scope > rect.c-mask');
      if (plate) {
        const fill = rgba(getComputedStyle(plate).fill);
        if (fill && fill[3] > 0) background = fill[3] < 1 ? over(fill, panelBg) : fill.slice(0, 3);
      }
    }
    const ink = rgba(style.fill);
    if (!ink || ink[3] === 0) continue;
    const rendered = over([ink[0], ink[1], ink[2], ink[3] * Number(style.fillOpacity || 1)], background);
    const ratio = contrast(rendered, background);
    sampled += 1;
    if (ratio < ${FLOOR}) failures.push(describe(text) + ' ' + ratio.toFixed(2) + ':1 ink ' + style.fill + ' on ' + background.join(','));
  }
  const htmlText = document.querySelectorAll('h1, .subtitle, .card h3, .card li, .toolbar button, .export-menu button, .preset-option strong, .preset-option small, .focus-chip, .focus-chip *, .diagram-nav button, .legend-inline *');
  for (const element of htmlText) {
    if (element.children.length && ![...element.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim())) continue;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || Number(style.opacity) === 0) continue;
    let background = null;
    for (let node = element; node; node = node.parentElement) {
      // A plate painted by ::before (the Export trigger) sits behind the text too.
      const before = getComputedStyle(node, '::before');
      const isPlate = before.content !== 'none' && before.content !== '' && before.position === 'absolute'
        && (before.maskImage === 'none' || before.maskImage === undefined) && (before.webkitMaskImage === 'none' || before.webkitMaskImage === undefined);
      const plate = isPlate ? rgba(before.backgroundColor) : null;
      if (plate && plate[3] >= 0.9) { background = plate.slice(0, 3); break; }
      const bg = rgba(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] >= 0.9) { background = bg.slice(0, 3); break; }
    }
    if (!background) background = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    const ink = rgba(style.color);
    const ratio = contrast(over(ink, background), background);
    sampled += 1;
    if (ratio < ${FLOOR}) failures.push(element.tagName.toLowerCase() + '.' + element.className + ' "' + element.textContent.trim().slice(0, 32) + '" ' + ratio.toFixed(2) + ':1');
  }
  return { failures: failures.slice(0, 30), total: failures.length, sampled, preset: document.documentElement.dataset.preset };
})()`;

test('rendered Hadrian text clears the floor in both themes across all five modes', { skip: skipWithoutChrome }, async (t) => {
  const directory = scratchDirectory(t, 'archify-hadrian-contrast-');
  const artifacts = renderDefaultExamples(directory, {
    // Tags put category ink on the node's own fill, the tightest pairing.
    mutate: (source) => { for (const node of source.components || source.nodes || source.states || []) if (!node.tag) node.tag = 'v2'; },
  });
  const { browser, evaluate } = await openBrowser(t);
  for (const [mode, artifactPath] of Object.entries(artifacts)) {
    for (const theme of ['dark', 'light']) {
      await browser.inspect({ artifactPath, width: 1440, height: 1000, theme });
      await evaluate(`(async () => {
        document.getElementById('btn-preset').click();
        const node = document.querySelector('.diagram-container svg [data-node-id]');
        if (node && window.Archify && Archify.focus) Archify.focus.set(node.getAttribute('data-node-id'), { toggle: false, updateUrl: false });
        const panel = document.querySelector('.diagram-container');
        if (panel) panel.setAttribute('data-detail-level', 'full');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })()`);
      const result = await evaluate(TEXT_PROBE);
      assert.equal(result.preset, 'hadrian', `${mode}/${theme}`);
      assert.ok(result.sampled > 20, `${mode}/${theme}: sampled ${result.sampled} text elements`);
      assert.deepEqual(result.failures, [], `${mode}/${theme}: ${result.total} text elements below ${FLOOR}:1`);
      t.diagnostic(`${mode}/${theme}: ${result.sampled} text elements sampled`);
    }
  }
});
