import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';
import {
  skillRoot, EN_TRANSLATIONS, PSEUDO_LOCALE, PSEUDO_MARKER, PSEUDO_TRANSLATIONS, PSEUDO_PARTIAL_TRANSLATIONS,
  MANIFEST, EXAMPLES, example, authoredExample, localeDocument, createLocaleFixture,
} from './helpers/i18n-fixture.mjs';

import {
  SUPPORTED_LOCALES,
  bundledLocaleFor,
  catalogKeys,
  resolveCatalog,
  resolveLocale,
  viewerCatalog,
  localizeTemplate,
  translateCount,
  translateMessage,
  registerLocale,
  validateTranslations,
} from '../archify/renderers/shared/i18n.mjs';

// This fork bundles English only. The locale machinery is unchanged: a
// well-formed meta.locale still selects a bundled catalog when one exists,
// meta.translations still overrides renderer-owned copy key by key, and every
// gap falls back to English with a disclosed warning. The pseudo-locale fixture
// stands in for the catalogs upstream ships.

const templatePath = path.join(skillRoot, 'assets/template.html');
const { tmp, run, cliJson } = createLocaleFixture();

function embeddedMessages(html) {
  const embedded = html.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(embedded, 'missing embedded i18n data script');
  return JSON.parse(embedded[1]);
}

test('the fork bundles exactly the English catalog', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en']);
  assert.deepEqual(MANIFEST.catalogs, [{ locale: 'en', file: 'en.json' }]);
  assert.equal(bundledLocaleFor('EN'), 'en');
  for (const locale of ['zh-CN', 'zh-TW', 'es', 'ko', 'ar', 'ja', 'fr', 'de']) {
    assert.equal(bundledLocaleFor(locale), null, `${locale} must not resolve to a bundled catalog`);
    assert.equal(resolveLocale(locale), 'en');
  }
});

test('a supplied catalog localizes renderer-owned output across all five modes without translating authored content', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = document.meta.title;
    document.meta.locale = PSEUDO_LOCALE;
    document.meta.translations = PSEUDO_TRANSLATIONS;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${PSEUDO_LOCALE}"`));
    assert.match(result.html, new RegExp(`<svg\\b[^>]*\\blang="${PSEUDO_LOCALE}"`));
    assert.ok(result.html.includes(`<title>${PSEUDO_MARKER}${authoredTitle} Diagram</title>`), `${type}: page title not localized or authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, new RegExp(`<text\\b[^>]*>\\[xx\\] Legend</text>`));
    assert.match(result.html, /aria-label="\[xx\] Focus /);
    assert.match(result.html, new RegExp(`"locale":"${PSEUDO_LOCALE}"`));
    assert.match(result.html, />\[xx\] Export diagram</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
    assert.equal(result.stderr, '', `${type}: a complete supplied catalog has no fallback to disclose`);
  }
});

test('explicit en and a supplied catalog preserve complete authored field inventories across all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const english = authoredExample(type, 'en');
    const pseudo = authoredExample(type, PSEUDO_LOCALE);
    assert.equal(english.authored.length, pseudo.authored.length, `${type}: authored shapes differ`);
    assert.ok(english.authored.length >= 10, `${type}: authored inventory is unexpectedly small`);
    if (type === 'dataflow') {
      assert.ok(
        english.authored.includes(english.document.flows[0].classification),
        'dataflow: classification is missing from the authored inventory',
      );
    }
    if (type === 'lifecycle') {
      assert.ok(
        english.authored.includes(english.document.states[0].step),
        'lifecycle: step is missing from the authored inventory',
      );
    }

    for (const candidate of [english, pseudo]) {
      const locale = candidate.document.meta.locale;
      const result = run(type, candidate.document);
      assert.equal(result.status, 0, `${type}/${locale}: ${result.stderr || result.stdout}`);
      assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
      assert.match(result.html, new RegExp(`<svg\\b[^>]*\\blang="${locale}"`));
      assert.match(result.html, new RegExp(`"locale":"${locale}"`));
      for (const authoredText of candidate.authored) {
        assert.ok(result.html.includes(authoredText), `${type}/${locale}: lost authored text ${authoredText}`);
      }
      if (locale === PSEUDO_LOCALE) {
        assert.ok(result.html.includes(`<title>${PSEUDO_MARKER}${candidate.document.meta.title} Diagram</title>`), type);
        assert.match(result.html, />\[xx\] Export diagram</);
      } else {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title} Diagram</title>`), type);
        assert.match(result.html, />Export diagram</);
      }
    }
  }
});

test('omitted locale preserves authored content and the English Viewer contract in all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = `Authored title ${type} with accents: Ångström, naïve, Ω`;
    document.meta.title = authoredTitle;
    delete document.meta.locale;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="en"/);
    assert.ok(result.html.includes(`<title>${authoredTitle} Diagram</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<svg\b[^>]*\blang="en"/);
    assert.match(result.html, /aria-label="Focus /);
    assert.match(result.html, /"locale":"en"/);
    assert.match(result.html, />Export diagram</);
  }
});

test('malformed locale tags fail schema validation in every mode', () => {
  const invalidLocales = ['123', 'x', 'en_US', 'a'.repeat(40)];
  for (const [index, type] of Object.keys(EXAMPLES).entries()) {
    for (const locale of invalidLocales) {
      const document = localeDocument(type, { locale });
      // The shared validator owns the complete tag matrix. Every type still
      // exercises the public CLI's structured rejection below.
      assert.throws(() => validateSchema(type, document), (error) => {
        assert.ok(error.archifyDiagnostics.some((entry) => entry.subject?.path === '/meta/locale'), `${type}: ${locale}`);
        return true;
      });
    }
    const locale = invalidLocales[index % invalidLocales.length];
    const result = run(type, localeDocument(type, { locale }), 'validate');
    assert.notEqual(result.status, 0, `${type}: malformed locale ${locale} unexpectedly passed`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((entry) => entry.subject?.path === '/meta/locale'), `${type}: ${locale}`);
  }
});

test('a well-formed locale without a bundled catalog passes validation, falls back to English chrome, and discloses the fallback', () => {
  // Upstream's bundled tags are ordinary unbundled tags in this fork: none
  // collapses onto a catalog without explicit data.
  for (const locale of ['fr', 'zh-CN', 'zh-Hant', 'es-MX', 'ko-KR', 'ar']) {
    // Locale resolution and diagnostics are shared through loadDiagram.
    // Check every tag through architecture, and every renderer with fr;
    // repeating the cross-product does not exercise another fallback path.
    const types = locale === 'fr' ? Object.keys(EXAMPLES) : ['architecture'];
    for (const type of types) {
      const document = example(type);
      document.meta.locale = locale;
      const validated = run(type, document, 'validate');
      assert.equal(validated.status, 0, `${type}/${locale}: ${validated.stderr || validated.stdout}`);
      assert.equal(JSON.parse(validated.stdout).ok, true, `${type}/${locale}`);
      assert.match(
        validated.stderr,
        new RegExp(`meta\\.locale "${locale}" has no bundled catalog and no usable meta\\.translations`),
        `${type}/${locale}: fallback was not disclosed`,
      );

      const rendered = run(type, document);
      assert.equal(rendered.status, 0, `${type}/${locale}: ${rendered.stderr || rendered.stdout}`);
      assert.match(rendered.html, /^<!DOCTYPE html>\n<html lang="en"/, `${type}/${locale}: did not fall back to en`);
      assert.match(rendered.html, />Export diagram</, `${type}/${locale}`);
    }
  }
});

test('an unbundled locale localizes renderer-owned output once meta.translations supplies it, with partial coverage falling back to English key by key', () => {
  const report = validateTranslations(PSEUDO_PARTIAL_TRANSLATIONS);
  assert.ok(report.coveredKeys > 0 && report.coveredKeys < report.totalKeys, 'fixture should demonstrate partial, not full or empty, coverage');
  assert.deepEqual(report.placeholderMismatches, []);

  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    document.meta.locale = PSEUDO_LOCALE;
    document.meta.translations = PSEUDO_PARTIAL_TRANSLATIONS;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${PSEUDO_LOCALE}"`), type);
    assert.match(result.html, new RegExp(`<svg\\b[^>]*\\blang="${PSEUDO_LOCALE}"`), type);
    assert.match(result.html, /<text\b[^>]*>\[xx\] Legend<\/text>/, `${type}: covered key did not localize`);
    assert.match(result.html, />\[xx\] Export diagram</, `${type}: covered key did not localize`);
    // A missing outline label falls back to the canonical English message.
    assert.match(result.html, />Node index</, `${type}: uncovered key did not fall back to English`);
    assert.match(
      result.stderr,
      new RegExp(`meta\\.locale "${PSEUDO_LOCALE}" resolves ${report.coveredKeys}/${report.totalKeys} renderer-owned messages \\(\\d+%\\) from ${report.coveredKeys} meta\\.translations entries; \\d+ fall back to English`),
      `${type}: coverage was not disclosed`,
    );
  }
});

test('translations with unknown keys or mismatched interpolation placeholders are reported and fall back to English per key', () => {
  const document = example('architecture');
  document.meta.locale = PSEUDO_LOCALE;
  document.meta.translations = {
    ...PSEUDO_PARTIAL_TRANSLATIONS,
    'node.focus': '{wrongPlaceholder} focused',
    'this.key.does.not.exist': 'orphan',
  };
  delete document.meta.subtitle;

  const result = run('architecture', document);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  // node.focus falls back to English because {wrongPlaceholder} does not
  // match the canonical {label} token: never a raw or broken template.
  assert.match(result.html, /aria-label="Focus /);
  assert.doesNotMatch(result.html, /wrongPlaceholder/);
  assert.match(result.stderr, new RegExp(`meta\\.translations for locale "${PSEUDO_LOCALE}" has 2 unusable entries \\(1 unknown, 1 placeholder mismatch\\); each keeps its English message`));
  assert.match(result.stderr, new RegExp(`meta\\.locale "${PSEUDO_LOCALE}" resolves \\d+/\\d+ renderer-owned messages`));
});

test('empty translations and equivalent tag casing select the same catalog', () => {
  const english = resolveCatalog('en');
  assert.deepEqual(resolveCatalog('en', {}).messages, english.messages);
  assert.deepEqual(resolveCatalog('en', {}).report, english.report);
  const overrides = { 'viewer.common.close': 'Dismiss panel', 'viewer.export.diagram': 'Export this diagram' };
  for (const locale of ['en', 'EN', 'eN']) {
    assert.deepEqual(resolveCatalog(locale).messages, english.messages);
    assert.equal(resolveCatalog(locale).report.resolvedLocale, 'en');
    try {
      registerLocale(locale, overrides);
      for (const lookup of [locale, 'en', 'EN']) {
        assert.equal(resolveLocale(lookup), 'en');
        assert.equal(translateMessage(lookup, 'viewer.common.close'), overrides['viewer.common.close']);
        assert.equal(viewerCatalog(lookup)['viewer.common.close'], overrides['viewer.common.close']);
        assert.equal(localizeTemplate('{{i18n:viewer.export.diagram}}', lookup), 'Export this diagram');
      }
    } finally {
      registerLocale(locale);
    }
  }
  // The schema requires a lowercase primary subtag, so the CLI witness uses
  // the canonical tag; case-insensitive catalog selection is covered above.
  for (const type of Object.keys(EXAMPLES)) {
    const reference = run(type, localeDocument(type, { locale: 'en' }));
    assert.equal(reference.status, 0, reference.stderr);
    assert.equal(reference.stderr, '');

    // The shared empty-override rule also has a real renderer witness.
    if (type === 'architecture') {
      const empty = run(type, localeDocument(type, { locale: 'en', translations: {} }));
      assert.equal(empty.status, 0, empty.stderr);
      assert.equal(empty.stderr, '');
      assert.equal(empty.html, reference.html, '{} is not an override');
    }
    const result = run(type, localeDocument(type, { locale: 'en', translations: overrides }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="en"/);
    const runtime = embeddedMessages(result.html);
    assert.equal(runtime.locale, 'en');
    assert.equal(runtime.messages['viewer.common.close'], 'Dismiss panel', `${type}: embedded Viewer override lost`);
    assert.ok(result.html.includes('>Export this diagram<'), `${type}: template override lost`);
  }
  assert.equal(bundledLocaleFor('EN'), 'en');
  assert.equal(bundledLocaleFor('en-GB'), null);
});

test('rejected overrides keep the bundled message and are reported apart from English fallback gaps', () => {
  const result = run('architecture', localeDocument('architecture', {
    locale: 'en',
    translations: {
      'viewer.common.close': 'Dismiss {panel}',
      'viewer.common.clear': 'Empty',
      'viewer.common.closee': 'Dismiss',
    },
  }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const runtime = embeddedMessages(result.html);
  assert.equal(runtime.messages['viewer.common.close'], EN_TRANSLATIONS['viewer.common.close']);
  assert.equal(runtime.messages['viewer.common.clear'], 'Empty');
  assert.match(result.stderr, /meta\.translations for locale "en" has 2 unusable entries \(1 unknown, 1 placeholder mismatch\); each keeps its bundled en message\./);
  assert.doesNotMatch(result.stderr, /fall back to English/, 'a rejected override over a complete catalog is not an English gap');

  const { report } = resolveCatalog('en', {
    'viewer.common.close': 'Dismiss {panel}',
    'viewer.common.clear': 'Empty',
    'viewer.common.closee': 'Dismiss',
  });
  assert.equal(report.translatedKeys, report.totalKeys);
  assert.deepEqual(report.fallbackKeys, []);
  assert.equal(report.override.appliedKeys, 1);
  assert.deepEqual(report.override.unknownKeys, ['viewer.common.closee']);
  assert.deepEqual(report.override.placeholderMismatches, [{ key: 'viewer.common.close', expected: [], actual: ['panel'] }]);
});

test('an unbundled tag with only unusable translations falls back to English UI and language metadata', () => {
  const result = run('architecture', localeDocument('architecture', {
    locale: 'fr',
    translations: { 'viewer.common.closee': 'Fermer' },
  }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.html, /^<!DOCTYPE html>\n<html lang="en"/);
  assert.match(result.stderr, /has 1 unusable entry \(1 unknown, 0 placeholder mismatch\); each keeps its English message/);
  assert.match(result.stderr, /meta\.locale "fr" has no bundled catalog and no usable meta\.translations/);
});

test('coverage reports the final resolved catalog with the English source of each gap', () => {
  const partial = resolveCatalog(PSEUDO_LOCALE, PSEUDO_PARTIAL_TRANSLATIONS).report;
  assert.equal(partial.resolvedLocale, PSEUDO_LOCALE);
  assert.equal(partial.bundledLocale, null);
  assert.equal(partial.translatedKeys, Object.keys(PSEUDO_PARTIAL_TRANSLATIONS).length);
  assert.equal(partial.translatedKeys + partial.fallbackKeys.length, partial.totalKeys);

  const oneKey = resolveCatalog('en', { 'viewer.common.close': 'Dismiss' }).report;
  assert.equal(oneKey.translatedKeys, oneKey.totalKeys, 'override size must not be reported as coverage');
  assert.equal(oneKey.override.appliedKeys, 1);

  // A supplied catalog that lags behind a new canonical key reports only that
  // gap; English is never a gap for English.
  const lagging = { ...PSEUDO_TRANSLATIONS };
  delete lagging['viewer.common.close'];
  const unbundled = resolveCatalog('xx-419', lagging).report;
  assert.deepEqual(unbundled.fallbackKeys, ['viewer.common.close']);
  assert.deepEqual(resolveCatalog('en', { 'viewer.common.close': 'Dismiss' }).report.fallbackKeys, []);
  assert.deepEqual(resolveCatalog('en-GB', { 'viewer.common.close': 'Dismiss' }).report.fallbackKeys, []);
});

test('a document override never mutates the reusable bundled catalog', () => {
  const before = translateMessage('en', 'viewer.common.close');
  const { messages } = resolveCatalog('en', { 'viewer.common.close': 'Dismiss panel' });
  assert.equal(messages['viewer.common.close'], 'Dismiss panel');
  assert.ok(Object.isFrozen(messages));
  assert.equal(translateMessage('en', 'viewer.common.close'), before);

  registerLocale('en', { 'viewer.common.close': 'Dismiss panel' });
  assert.equal(translateMessage('en', 'viewer.common.close'), 'Dismiss panel');
  registerLocale('en');
  assert.equal(translateMessage('en', 'viewer.common.close'), before, 'a later document without overrides reuses the bundled catalog');
});

test('validate and deliver receipts carry locale warnings as structured diagnostics without failing', () => {
  const input = path.join(tmp, 'receipt-xx.json');
  fs.writeFileSync(input, JSON.stringify(localeDocument('architecture', {
    locale: PSEUDO_LOCALE,
    translations: { ...PSEUDO_PARTIAL_TRANSLATIONS, 'viewer.common.closee': 'Dismiss' },
  })));
  const cli = path.join(skillRoot, 'bin/archify.mjs');
  for (const command of ['validate', 'deliver']) {
    const args = [cli, command, 'architecture', input, ...(command === 'deliver' ? [path.join(tmp, 'receipt-xx.html')] : [])];
    const machine = spawnSync(process.execPath, [...args, '--json'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(machine.status, 0, machine.stderr || machine.stdout);
    const receipt = JSON.parse(machine.stdout);
    assert.equal(receipt.ok, true);
    assert.deepEqual(receipt.diagnostics.map((entry) => [entry.code, entry.severity]), [
      ['i18n/invalid-translation', 'warning'],
      ['i18n/translation-coverage', 'warning'],
    ]);
    const coverage = receipt.diagnostics[1].evidence;
    assert.equal(coverage.missingKeysTotal, coverage.totalKeys - coverage.translatedKeys);
    assert.equal(coverage.missingKeys.length, 10);
    for (const key of coverage.missingKeys) assert.equal(coverage.englishSource[key], translateMessage('en', key));
    assert.deepEqual(receipt.diagnostics[0].evidence.unknownKeys, ['viewer.common.closee']);
    const expectedWarnings = receipt.diagnostics.map(entry => `archify: ${entry.message}\n`).join('');
    assert.equal(machine.stderr, expectedWarnings, `${command}: JSON success discloses each warning once`);
    const human = spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8' });
    assert.equal(human.status, 0, human.stderr || human.stdout);
    assert.equal(human.stderr, expectedWarnings, `${command}: human success discloses each warning once`);
    assert.ok(human.stdout.trim());
  }

  const clean = path.join(tmp, 'receipt-en.json');
  fs.writeFileSync(clean, JSON.stringify(localeDocument('architecture', { locale: 'en' })));
  assert.equal(cliJson(['validate', 'architecture', clean, '--json']).diagnostics, undefined);
  assert.equal(cliJson(['deliver', 'architecture', clean, path.join(tmp, 'receipt-en.html'), '--json']).diagnostics, undefined);
});

test('the manifest enrolls exactly the bundled catalogs, and each is complete', () => {
  assert.deepEqual(MANIFEST.catalogs.map(({ locale }) => locale), SUPPORTED_LOCALES);
  const files = fs.readdirSync(path.join(skillRoot, 'locales')).filter((file) => file.endsWith('.json') && file !== 'manifest.json').sort();
  assert.deepEqual(MANIFEST.catalogs.map(({ file }) => file).sort(), files, 'every bundled catalog file is enrolled and every entry exists');
  for (const { locale, file } of MANIFEST.catalogs) {
    const report = validateTranslations(JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales', file), 'utf8')));
    assert.equal(report.coveredKeys, report.totalKeys, `${locale}: missing ${report.missingKeys.join(', ')}`);
    assert.deepEqual(report.unknownKeys, [], locale);
    assert.deepEqual(report.placeholderMismatches, [], locale);
  }
});

test('enrolling a catalog is a data-only change and works from an unrelated working directory', () => {
  // Copy the runtime (no tests, no node_modules) outside the checkout, enroll
  // one more catalog through data alone, and render from an unrelated cwd.
  const packageRoot = path.join(tmp, 'package-copy', 'archify');
  fs.cpSync(skillRoot, packageRoot, {
    recursive: true,
    filter: (source) => !['node_modules', 'test'].includes(path.basename(source)) || path.dirname(source) !== skillRoot,
  });
  fs.writeFileSync(path.join(packageRoot, 'locales/xx.json'), JSON.stringify(PSEUDO_PARTIAL_TRANSLATIONS));
  const manifestPath = path.join(packageRoot, 'locales/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.catalogs.push({ locale: PSEUDO_LOCALE, file: 'xx.json' });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-i18n-cwd-'));
  // A decoy catalog in the working directory must never be picked up.
  fs.mkdirSync(path.join(unrelated, 'locales'));
  fs.writeFileSync(path.join(unrelated, 'locales/manifest.json'), '{"catalogs":[]}');
  const input = path.join(unrelated, 'xx.json');
  const output = path.join(unrelated, 'xx.html');
  fs.writeFileSync(input, JSON.stringify(localeDocument('architecture', { locale: PSEUDO_LOCALE })));
  const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/archify.mjs'), 'render', 'architecture', input, output], {
    cwd: unrelated,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${PSEUDO_LOCALE}"`));
  assert.match(html, /<text\b[^>]*>\[xx\] Legend<\/text>/);
  assert.match(result.stderr, new RegExp(`meta\\.locale "${PSEUDO_LOCALE}" resolves \\d+/\\d+ renderer-owned messages \\(\\d+%\\) from the bundled ${PSEUDO_LOCALE} catalog; \\d+ fall back to English`));
});

test('every Viewer message reference resolves through the shared catalog', () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const keys = new Set(catalogKeys());
  const references = new Set([
    ...[...template.matchAll(/\{\{i18n:([a-zA-Z0-9_.-]+)\}\}/g)].map((match) => match[1]),
    ...[...template.matchAll(/['"](viewer\.[a-zA-Z0-9_.-]+)['"]/g)].map((match) => match[1]),
  ]);
  const unresolved = [...references].filter((key) => (
    !key.endsWith('.') && !keys.has(key) && !(keys.has(`${key}.one`) && keys.has(`${key}.other`))
  ));
  assert.deepEqual(unresolved, []);
});

test('every supported catalog is complete and preserves interpolation variables', () => {
  const variables = (value) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();
  for (const key of catalogKeys()) {
    const expected = variables(translateMessage('en', key));
    for (const locale of SUPPORTED_LOCALES) {
      const message = translateMessage(locale, key);
      assert.ok(message && message !== 'undefined', `${locale}: ${key}`);
      assert.deepEqual(variables(message), expected, `${locale}: ${key}`);
    }
  }
});

test('runtime labels compose from the catalog', () => {
  const enHop = translateCount('en', 'viewer.route.overview.hop', 1);
  const enNode = translateCount('en', 'viewer.route.overview.node', 2);
  assert.equal(
    translateMessage('en', 'viewer.route.overview.status', { nodes: enNode, hops: enHop }),
    '2 nodes · 1 step · shortest path',
  );
  registerLocale(PSEUDO_LOCALE, PSEUDO_TRANSLATIONS);
  try {
    assert.equal(translateMessage(PSEUDO_LOCALE, 'viewer.kind.backend'), `${PSEUDO_MARKER}${EN_TRANSLATIONS['viewer.kind.backend']}`);
    const hops = translateCount(PSEUDO_LOCALE, 'viewer.route.hop', 2);
    assert.ok(hops.startsWith(PSEUDO_MARKER));
    assert.equal(
      translateMessage(PSEUDO_LOCALE, 'viewer.finder.result.routeTarget', { label: 'Target', links: hops }),
      `${PSEUDO_MARKER}${EN_TRANSLATIONS['viewer.finder.result.routeTarget'].replace('{label}', 'Target').replace('{links}', hops)}`,
    );
  } finally {
    registerLocale(PSEUDO_LOCALE);
  }
});

test('Share Card and export failures use catalog messages instead of fixed English', () => {
  registerLocale(PSEUDO_LOCALE, PSEUDO_TRANSLATIONS);
  try {
    assert.equal(
      translateCount(PSEUDO_LOCALE, 'viewer.export.card.routeSummary', 2, { source: 'Source', target: 'Target' }),
      `${PSEUDO_MARKER}Path: Source → Target · 2 steps`,
    );
    assert.ok(translateMessage(PSEUDO_LOCALE, 'viewer.export.error.toBlobNull', { label: 'Share Card' }).startsWith(PSEUDO_MARKER));
  } finally {
    registerLocale(PSEUDO_LOCALE);
  }

  const template = fs.readFileSync(templatePath, 'utf8');
  for (const hardcoded of [
    "'Route: '",
    "'Share Card variants cannot be combined'",
    "canvas2dOrThrow(canvas, 'Share Card')",
    "'Share Card export could not remove temporary viewer state'",
    "'WebM motion export requires a trace animation and browser MediaRecorder support'",
  ]) {
    assert.ok(!template.includes(hardcoded), hardcoded);
  }
});
