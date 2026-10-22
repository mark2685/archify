import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';

// Shared fixture for the Hadrian brand guards: render the five bundled
// examples with the fork's default (no visual_preset) and open them in real
// Chrome. Browser evidence is skipped, never passed, without ARCHIFY_CHROME.

export const skillRoot = fileURLToPath(new URL('../../archify/', import.meta.url));
export const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
export const skipWithoutChrome = chromePath ? false : 'Set ARCHIFY_CHROME to run the Hadrian browser guards.';

export const EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

export function renderDefaultExamples(directory, { animation = null, mutate } = {}) {
  const artifacts = {};
  for (const [mode, file] of Object.entries(EXAMPLES)) {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', file), 'utf8'));
    delete source.meta.visual_preset;
    if (animation) source.meta.animation = animation;
    if (mutate) mutate(source, mode);
    const input = path.join(directory, `${mode}.json`);
    const output = path.join(directory, `${mode}.html`);
    fs.writeFileSync(input, JSON.stringify(source));
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output]);
    artifacts[mode] = output;
  }
  return artifacts;
}

export function scratchDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export async function openBrowser(t) {
  const browser = new ChromeVisualBrowser(chromePath);
  t.after(() => browser.close());
  const sessionId = await browser.sessionPromise;
  const evaluate = async (expression) => {
    const response = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'browser evaluation failed');
    }
    return response.result?.value;
  };
  return { browser, sessionId, evaluate };
}

// WCAG relative luminance and contrast, as browser-side source for evaluate().
export const CONTRAST_SOURCE = `
  const rgba = (value) => {
    const m = value.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const luminance = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
  const contrast = (fg, bg) => { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
`;
