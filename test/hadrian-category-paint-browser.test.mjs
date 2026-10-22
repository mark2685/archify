import test from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser, renderDefaultExamples, scratchDirectory, skipWithoutChrome } from './helpers/hadrian-browser.mjs';

// test/hadrian-distinguishability.test.mjs and the static half of
// test/hadrian-contrast.test.mjs measure the category tokens in hadrian.css.
// That evidence holds only if rendered nodes paint those tokens: upstream's
// card style recomputes dark node colours from the stroke, which once hid the
// Hadrian fills entirely. This test reads the painted fill and stroke of every
// architecture and workflow node in Chrome and compares them with the tokens.

const TONES = ['frontend', 'backend', 'database', 'messagebus', 'security', 'cloud', 'external'];

const PAINT_PROBE = `(() => {
  const svg = document.querySelector('.diagram-container > svg');
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  svg.appendChild(probe);
  const token = (name, property) => { probe.style[property] = 'var(' + name + ')'; return getComputedStyle(probe)[property]; };
  const mismatches = [];
  const seen = {};
  for (const rect of svg.querySelectorAll('[data-node-id] > rect:not(.c-mask)')) {
    const tone = ${JSON.stringify(TONES)}.find((name) => rect.classList.contains('c-' + name));
    if (!tone) continue;
    seen[tone] = (seen[tone] || 0) + 1;
    const style = getComputedStyle(rect);
    const id = rect.parentElement.getAttribute('data-node-id');
    for (const [property, part] of [['fill', 'fill'], ['stroke', 'stroke']]) {
      const expected = token('--' + tone + '-' + part, property);
      if (style[property] !== expected) mismatches.push(id + ' (' + tone + ') ' + property + ' ' + style[property] + ' != --' + tone + '-' + part + ' ' + expected);
    }
  }
  probe.remove();
  return { mismatches, seen, preset: document.documentElement.dataset.preset, theme: document.documentElement.dataset.theme };
})()`;

test('Hadrian architecture and workflow nodes paint the category tokens in both themes', { skip: skipWithoutChrome }, async (t) => {
  const directory = scratchDirectory(t, 'archify-hadrian-paint-');
  const { architecture, workflow } = renderDefaultExamples(directory);
  const { browser, evaluate } = await openBrowser(t);
  for (const theme of ['dark', 'light']) {
    const painted = new Set();
    for (const [mode, artifactPath] of Object.entries({ architecture, workflow })) {
      await browser.inspect({ artifactPath, width: 1440, height: 1000, theme });
      const result = await evaluate(PAINT_PROBE);
      assert.equal(result.preset, 'hadrian', `${mode}/${theme}`);
      assert.equal(result.theme, theme, `${mode}/${theme}`);
      assert.deepEqual(result.mismatches, [], `${mode}/${theme}: nodes that do not paint their category tokens`);
      for (const tone of Object.keys(result.seen)) painted.add(tone);
    }
    assert.deepEqual([...painted].sort(), [...TONES].sort(), `${theme}: every category is painted by at least one node`);
  }
});
