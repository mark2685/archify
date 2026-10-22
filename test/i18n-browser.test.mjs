import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome, runVisualCheck } from '../archify/bin/visual-check.mjs';
import {
  EXAMPLES, example, localeDocument, createLocaleFixture,
  PSEUDO_LOCALE, PSEUDO_MARKER, PSEUDO_TRANSLATIONS, PSEUDO_PARTIAL_TRANSLATIONS, EN_TRANSLATIONS,
} from './helpers/i18n-fixture.mjs';

const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const { tmp, run, cliJson } = createLocaleFixture();

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'browser evaluation failed');
  }
  return response.result?.value;
}

async function loadArtifact(browser, artifactPath) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); });
  })`, true);
  return sessionId;
}

test('a passing finalize keeps locale warnings in its receipt', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run finalize with its browser gate.',
}, () => {
  const input = path.join(tmp, 'finalize-xx.json');
  fs.writeFileSync(input, JSON.stringify(localeDocument('architecture', { locale: PSEUDO_LOCALE, translations: PSEUDO_PARTIAL_TRANSLATIONS })));
  const summary = cliJson(['finalize', 'architecture', input, path.join(tmp, 'finalize-xx.html'), '--quality', 'showcase', '--json']);
  assert.equal(summary.ok, true);
  assert.equal(summary.status, 'pass');
  assert.deepEqual(summary.diagnostics.map((entry) => entry.code), ['i18n/translation-coverage']);
  const full = JSON.parse(fs.readFileSync(summary.evidence.receipt, 'utf8'));
  assert.deepEqual(full.diagnostics.map((entry) => entry.code), ['i18n/translation-coverage']);
});

// Expected chrome for the pseudo-locale is derived from the canonical catalog,
// so a renamed key fails here instead of silently passing with stale copy.
const t = (key, values = {}) => PSEUDO_TRANSLATIONS[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
const BROWSER_LOCALES = {
  [PSEUDO_LOCALE]: {
    title: (type) => `Browser localization ${type}`,
    toolbarLabel: t('viewer.nav.controls'),
    finder: { hidden: false, title: t('viewer.finder.title'), searchLabel: t('viewer.finder.search') },
    route: { hidden: false, title: t('viewer.route.start'), label: t('viewer.route.trigger.clear') },
    exportLabel: t('viewer.export.diagram'),
    exportMenuLabel: t('viewer.export.menu'),
    exportMenuText: new RegExp(PSEUDO_MARKER.replace('[', '\\[') + EN_TRANSLATIONS['viewer.export.copyDiagram']),
    presetBadges: {
      'signal-flow': { header: t('viewer.preset.badge.signalFlow'), plate: 'none' },
      blueprint: { header: t('viewer.preset.badge.blueprint'), plate: '' },
      editorial: { header: t('viewer.preset.badge.editorial'), plate: t('viewer.preset.badge.editorialPlate') },
    },
    shareCardFailure: t('viewer.export.error.contextUnavailable', { label: t('viewer.export.shareCard') }),
  },
};

async function assertLocalizedViewer(browser, locale, expected) {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    document.meta.locale = locale;
    document.meta.translations = PSEUDO_TRANSLATIONS;
    const authoredTitle = expected.title(type);
    document.meta.title = authoredTitle;
    const result = run(type, document);
    assert.equal(result.status, 0, `${locale}/${type}: ${result.stderr || result.stdout}`);

    const sessionId = await loadArtifact(browser, result.output);
    const state = await evaluate(browser, sessionId, `(function () {
      var finderButton = document.getElementById('btn-node-finder');
      var routeButton = document.getElementById('btn-route-probe');
      var exportButton = document.getElementById('btn-export');
      finderButton.click();
      var finder = {
        hidden: document.getElementById('node-finder').hidden,
        title: document.getElementById('node-finder-title').textContent.trim(),
        searchLabel: document.getElementById('node-finder-input').getAttribute('aria-label')
      };
      document.getElementById('node-finder-close').click();
      routeButton.click();
      var route = {
        hidden: document.getElementById('route-probe').hidden,
        title: document.getElementById('route-probe-title').textContent.trim(),
        label: routeButton.getAttribute('aria-label')
      };
      routeButton.click();
      exportButton.click();
      var exportMenu = document.getElementById('export-menu');
      function pseudoContent(selector) {
        var content = getComputedStyle(document.querySelector(selector), '::after').content || '';
        return content.replace(/^["']|["']$/g, '');
      }
      var presetBadges = {};
      ['signal-flow', 'blueprint', 'editorial'].forEach(function (preset) {
        document.documentElement.setAttribute('data-preset', preset);
        presetBadges[preset] = {
          header: pseudoContent('.header-row'),
          plate: pseudoContent('.diagram-container')
        };
      });
      return {
        htmlLang: document.documentElement.lang,
        svgLang: document.querySelector('.diagram-container svg').getAttribute('lang'),
        heading: (document.querySelector('h1') || {}).textContent,
        toolbarLabel: document.querySelector('.diagram-nav').getAttribute('aria-label'),
        finder: finder,
        route: route,
        exportMenuOpen: exportMenu.classList.contains('open'),
        exportLabel: exportButton.getAttribute('aria-label'),
        exportMenuLabel: exportMenu.getAttribute('aria-label'),
        exportMenuText: exportMenu.textContent,
        presetBadges: presetBadges
      };
    })()`);

    assert.equal(state.htmlLang, locale, `${locale}/${type}`);
    assert.equal(state.svgLang, locale, `${locale}/${type}`);
    // Authored copy stays verbatim while the surrounding chrome localizes.
    assert.equal(state.heading, authoredTitle, `${locale}/${type}: authored heading changed`);
    assert.equal(state.toolbarLabel, expected.toolbarLabel, `${locale}/${type}`);
    assert.deepEqual(state.finder, expected.finder, `${locale}/${type}`);
    assert.deepEqual(state.route, expected.route, `${locale}/${type}`);
    assert.equal(state.exportMenuOpen, true, `${locale}/${type}`);
    assert.equal(state.exportLabel, expected.exportLabel, `${locale}/${type}`);
    assert.equal(state.exportMenuLabel, expected.exportMenuLabel, `${locale}/${type}`);
    assert.match(state.exportMenuText, expected.exportMenuText, `${locale}/${type}`);
    assert.deepEqual(state.presetBadges, expected.presetBadges, `${locale}/${type}`);

    const shareCardFailure = await evaluate(browser, sessionId, `(async function () {
      var originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function () { return null; };
      try {
        var edge = document.querySelector('.diagram-container svg [data-edge-from][data-edge-to]');
        Archify.routeProbe.begin({ source: edge.getAttribute('data-edge-from'), focusNode: false });
        Archify.routeProbe.choose(edge.getAttribute('data-edge-to'), { updateUrl: false });
        await Archify.exportMenu.shareCard({ variant: 'route' });
        return { rejected: false, message: '' };
      } catch (error) {
        return { rejected: true, message: String(error && error.message || error) };
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
      }
    })()`, true);
    assert.deepEqual(shareCardFailure, {
      rejected: true,
      message: expected.shareCardFailure,
    }, `${locale}/${type}`);

    // Keep every locale/type's real viewport, theme, font and capture checks.
    // The delivered fixtures above retain the public visual-check CLI receipt
    // contract; this matrix calls the same checker without another CLI process.
    // Its default factory still creates a fresh Chrome profile for each artifact.
    const visual = await runVisualCheck({ artifactPath: result.output, chromePath });
    assert.ok([0, 1].includes(visual.exitCode), `${locale}/${type}: ${JSON.stringify(visual.receipt)}`);
    const receipt = visual.receipt;
    assert.equal(receipt.visualReview, 'pending', `${locale}/${type}`);
    assert.equal(receipt.chrome.status, 'available', `${locale}/${type}`);
    assert.equal(receipt.readability.status, 'pass', `${locale}/${type}`);
    assert.equal(receipt.viewerChrome.status, 'pass', `${locale}/${type}`);
    assert.equal(receipt.captures.status, 'pass', `${locale}/${type}`);
    assert.equal(
      receipt.containment.viewports.every((viewport) => viewport.overflowX === false),
      true,
      `${locale}/${type}: localized Viewer introduced horizontal overflow`,
    );
  }
}

test('real Chrome keeps supplied-catalog Finder, Route, Export, and accessibility UI localized in all five modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await assertLocalizedViewer(browser, PSEUDO_LOCALE, BROWSER_LOCALES[PSEUDO_LOCALE]);
  } finally {
    await browser.close();
  }
});
