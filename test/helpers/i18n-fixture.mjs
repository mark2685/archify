import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const skillRoot = fileURLToPath(new URL('../../archify/', import.meta.url));
export const cli = path.join(skillRoot, 'bin/archify.mjs');

// locales/ holds the package-owned catalogs that meta.locale selects through
// locales/manifest.json. This fork bundles English only, so the genericity of
// meta.translations is proved with a synthetic pseudo-locale derived from the
// canonical catalog: every message keeps its placeholders and gains a visible
// marker, so a leaked English string and a lost override are both detectable.
export const EN_TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/en.json'), 'utf8'));
export const MANIFEST = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/manifest.json'), 'utf8'));
export const PSEUDO_LOCALE = 'xx';
export const PSEUDO_MARKER = '[xx] ';
export const PSEUDO_TRANSLATIONS = Object.fromEntries(
  Object.entries(EN_TRANSLATIONS).map(([key, message]) => [key, `${PSEUDO_MARKER}${message}`]),
);
// Deliberately partial: the legend and export labels are covered, the node
// index title is not, so coverage reporting and per-key fallback are exercised.
export const PSEUDO_PARTIAL_TRANSLATIONS = Object.fromEntries(
  Object.entries(PSEUDO_TRANSLATIONS).filter(([key], index) => key !== 'viewer.outline.title'
    && (index % 2 === 0 || key === 'legend.title' || key === 'viewer.export.diagram')),
);

export const EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

export function example(type) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[type]), 'utf8'));
}

const AUTHORED_TEXT_KEYS = new Set([
  'title',
  'subtitle',
  'label',
  'sublabel',
  'tag',
  'note',
  'context',
  'responsibility',
  'classification',
  'step',
]);

// Replaces every authored string with a numbered marker so a test can prove
// that localization never rewrites authored content. With the pseudo-locale,
// renderer-owned copy is supplied through meta.translations.
export function authoredExample(type, locale) {
  const document = example(type);
  const authored = [];
  let authoredIndex = 0;
  const nextAuthoredText = () => {
    authoredIndex += 1;
    const value = `Copy${String(authoredIndex).padStart(2, '0')}`;
    authored.push(value);
    return value;
  };
  const rewrite = (value, path = []) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => rewrite(item, [...path, index]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && AUTHORED_TEXT_KEYS.has(key)) {
        value[key] = nextAuthoredText();
      } else if (key === 'items' && path.includes('cards') && Array.isArray(child)) {
        value[key] = child.map((item) => (typeof item === 'string' ? nextAuthoredText() : item));
      } else {
        rewrite(child, [...path, key]);
      }
    }
  };

  rewrite(document);
  document.meta.locale = locale;
  if (locale === PSEUDO_LOCALE) document.meta.translations = PSEUDO_TRANSLATIONS;
  if (!document.meta.subtitle) document.meta.subtitle = nextAuthoredText();
  return { document, authored };
}

export function localeDocument(type, meta) {
  const document = example(type);
  delete document.meta.subtitle;
  Object.assign(document.meta, meta);
  return document;
}

// Each suite owns its files; sharing fixture code never shares rendered output.
export function createLocaleFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-i18n-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  let sequence = 0;

  function run(type, document, command = 'render') {
    const id = sequence++;
    const input = path.join(tmp, `${id}-${type}.json`);
    const output = path.join(tmp, `${id}-${type}.html`);
    fs.writeFileSync(input, JSON.stringify(document));
    const args = command === 'render'
      ? [cli, 'render', type, input, output]
      : [cli, 'validate', type, input, '--json'];
    const result = spawnSync(process.execPath, args, { cwd: skillRoot, encoding: 'utf8' });
    return {
      ...result,
      output,
      html: result.status === 0 && command === 'render' ? fs.readFileSync(output, 'utf8') : '',
    };
  }

  function cliJson(args) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }

  return { tmp, run, cliJson };
}
