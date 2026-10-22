import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, renderDefaultExamples, scratchDirectory, skipWithoutChrome, skillRoot } from './helpers/hadrian-browser.mjs';

// With no meta.visual_preset, a document resolves to the Hadrian preset in the
// HTML root, the canonical SVG, the standalone SVG export and the PNG export,
// in both themes. The style picker offers Hadrian and Editorial only.

const NAVY = [0, 37, 72];
const GRAY_100 = [244, 246, 249];

test('omitting visual_preset resolves to hadrian in the HTML root and canonical SVG for every mode', (t) => {
  const directory = scratchDirectory(t, 'archify-hadrian-default-static-');
  for (const mode of ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']) {
    const example = fs.readdirSync(path.join(skillRoot, 'examples')).find((file) => file.endsWith(`.${mode}.json`));
    assert.ok(example, `${mode} has a bundled example`);
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    delete source.meta.visual_preset;
    const input = path.join(directory, `${mode}.json`);
    const output = path.join(directory, `${mode}.html`);
    fs.writeFileSync(input, JSON.stringify(source));
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<html lang="en" data-theme="dark" data-preset="hadrian">/, `${mode}: HTML root`);
    assert.match(html, /<svg\b[^>]* data-preset="hadrian"/, `${mode}: canonical SVG`);
  }
});

test('the HTML, canonical SVG, SVG export and PNG export all resolve to hadrian', { skip: skipWithoutChrome }, async (t) => {
  const directory = scratchDirectory(t, 'archify-hadrian-default-');
  const artifacts = renderDefaultExamples(directory);
  const { browser, sessionId, evaluate } = await openBrowser(t);
  await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.exportDownloads = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); window.lastBlob = blob; return url; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { exportDownloads.push({ name: this.download, blob: window.lastBlob }); return; } return click.call(this); };
  ` }, sessionId);

  for (const [mode, artifactPath] of Object.entries(artifacts)) {
    const html = fs.readFileSync(artifactPath, 'utf8');
    assert.match(html, /<html lang="en" data-theme="dark" data-preset="hadrian">/, `${mode}: HTML root`);
    assert.match(html, /<svg\b[^>]* data-preset="hadrian"/, `${mode}: canonical SVG`);
    for (const theme of ['dark', 'light']) {
      await browser.inspect({ artifactPath, width: 1440, height: 1000, theme });
      const state = await evaluate(`(() => ({
        html: document.documentElement.dataset.preset,
        svg: document.querySelector('.diagram-container > svg').dataset.preset,
        picker: [...document.querySelectorAll('#preset-menu [data-preset-value]')].filter((option) => !option.hidden).map((option) => option.dataset.presetValue),
        label: document.getElementById('preset-label').textContent.trim(),
        background: getComputedStyle(document.body).backgroundColor,
      }))()`);
      assert.equal(state.html, 'hadrian', `${mode}/${theme}`);
      assert.equal(state.svg, 'hadrian', `${mode}/${theme}`);
      assert.deepEqual(state.picker, ['hadrian', 'editorial'], `${mode}/${theme}: picker offers Hadrian and Editorial only`);
      assert.equal(state.label, 'Hadrian', `${mode}/${theme}`);
      assert.equal(state.background, theme === 'dark' ? 'rgb(0, 37, 72)' : 'rgb(244, 246, 249)', `${mode}/${theme}: page ground`);

      await evaluate(`Archify.exportMenu.run('svg')`);
      const svgText = await evaluate(`exportDownloads.at(-1).blob.text()`);
      assert.match(svgText, /<svg\b[^>]* data-preset="hadrian"/, `${mode}/${theme}: exported SVG root keeps the preset`);
      assert.match(svgText, /--bg: #002548;/, `${mode}/${theme}: exported SVG carries the Hadrian dark variables`);
      assert.match(svgText, /--bg: #f4f6f9;/, `${mode}/${theme}: exported SVG carries the Hadrian light variables`);
      // Upstream's shared node-card style keeps its own color-mix(); the Hadrian
      // variables themselves resolve to plain colours for non-browser consumers.
      for (const variable of svgText.match(/--(?:bg|text|arrow|[a-z]+-stroke|[a-z]+-fill|panel|mask): [^;]+;/g) || []) {
        assert.doesNotMatch(variable, /color-mix\(|color\(/, `${mode}/${theme}: ${variable}`);
      }

      await evaluate(`Archify.exportMenu.run('png')`);
      const corner = await evaluate(`(async () => {
        const blob = exportDownloads.at(-1).blob;
        const image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixel = context.getImageData(2, 2, 1, 1).data;
        const width = image.width;
        image.close();
        return { type: blob.type, pixel: [pixel[0], pixel[1], pixel[2], pixel[3]], width };
      })()`);
      assert.equal(corner.type, 'image/png');
      assert.ok(corner.width > 0);
      const expected = theme === 'dark' ? NAVY : GRAY_100;
      for (const [index, channel] of expected.entries()) {
        assert.ok(Math.abs(corner.pixel[index] - channel) <= 2, `${mode}/${theme}: PNG background pixel ${corner.pixel} is not the Hadrian ${theme} ground ${expected}`);
      }
      assert.equal(corner.pixel[3], 255);
    }
  }
});
