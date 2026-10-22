import test from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser, renderDefaultExamples, scratchDirectory, skipWithoutChrome } from './helpers/hadrian-browser.mjs';

// Brand shape rules, measured on rendered pages rather than read from CSS: in
// the Hadrian preset nothing is rounded, nothing casts a shadow or glow, and
// every visible edge is a 1px hairline (FORK.md, "Brand rules"). Upstream's
// stylesheet rounds and lifts many surfaces; hadrian.css must undo all of it.

const SHAPE_PROBE = `(() => {
  const offenders = [];
  const root = document.documentElement;
  const seen = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('svg')) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || !seen(element)) continue;
    const tag = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + (element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      if (style[corner] !== '0px') offenders.push(tag + ' ' + corner + ' ' + style[corner]);
    }
    if (style.boxShadow !== 'none') offenders.push(tag + ' box-shadow ' + style.boxShadow);
    if (style.textShadow !== 'none') offenders.push(tag + ' text-shadow ' + style.textShadow);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(style['border' + side + 'Width']);
      if (style['border' + side + 'Style'] !== 'none' && width > 1) offenders.push(tag + ' border-' + side.toLowerCase() + '-width ' + width + 'px');
    }
    for (const pseudo of ['::before', '::after']) {
      const p = getComputedStyle(element, pseudo);
      if (p.content === 'none' || p.content === '') continue;
      for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
        if (p[corner] !== '0px') offenders.push(tag + pseudo + ' ' + corner + ' ' + p[corner]);
      }
      if (p.boxShadow !== 'none') offenders.push(tag + pseudo + ' box-shadow ' + p.boxShadow);
    }
  }
  const svg = document.querySelector('.diagram-container > svg');
  for (const rect of svg.querySelectorAll('rect')) {
    const style = getComputedStyle(rect);
    const rx = parseFloat(style.rx), ry = parseFloat(style.ry);
    if ((Number.isFinite(rx) && rx > 0) || (Number.isFinite(ry) && ry > 0)) offenders.push('svg rect rx ' + style.rx + ' ry ' + style.ry + ' ' + (rect.getAttribute('class') || ''));
  }
  for (const element of svg.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    if (style.filter !== 'none') offenders.push('svg ' + element.tagName + ' filter ' + style.filter);
  }
  return { offenders: offenders.slice(0, 40), total: offenders.length, preset: root.dataset.preset, theme: root.dataset.theme };
})()`;

test('rendered Hadrian pages have no rounded corners, shadows, glows or edges wider than 1px', { skip: skipWithoutChrome }, async (t) => {
  const directory = scratchDirectory(t, 'archify-hadrian-shape-');
  const artifacts = renderDefaultExamples(directory, { animation: 'trace' });
  const { browser, evaluate } = await openBrowser(t);
  for (const [mode, artifactPath] of Object.entries(artifacts)) {
    for (const theme of ['dark', 'light']) {
      await browser.inspect({ artifactPath, width: 1440, height: 1000, theme });
      // Open the chrome that is normally hidden so it is measured too.
      await evaluate(`(async () => {
        document.getElementById('btn-preset').click();
        document.getElementById('btn-export').click();
        const node = document.querySelector('.diagram-container svg [data-node-id]');
        if (node && window.Archify && Archify.focus) Archify.focus.set(node.getAttribute('data-node-id'), { toggle: false, updateUrl: false });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })()`);
      const result = await evaluate(SHAPE_PROBE);
      assert.equal(result.preset, 'hadrian', `${mode}/${theme}`);
      assert.equal(result.theme, theme, `${mode}/${theme}`);
      assert.deepEqual(result.offenders, [], `${mode}/${theme}: ${result.total} shape offenders`);
    }
  }
});
