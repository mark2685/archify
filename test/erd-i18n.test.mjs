import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');

function fixture(translations, locale = 'en') {
  return {
    schema_version: 1,
    diagram_type: 'erd',
    meta: {
      title: 'Authored data model', locale, output: 'diagram.html',
      ...(translations === undefined ? {} : { translations }),
    },
    entities: [{
      id: 'users', label: 'Authored users', pos: [80, 80],
      attributes: [{ name: 'user_id', type: 'int', key: 'pk' }],
    }],
  };
}

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-i18n-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(directory, document, command = 'render') {
  fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(document));
  const args = [cli, command, 'erd', 'input.json'];
  if (command !== 'validate') args.push('diagram.html');
  if (command !== 'render') args.push('--json');
  return spawnSync(process.execPath, args, {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
}

function html(directory) {
  return fs.readFileSync(path.join(directory, 'diagram.html'), 'utf8');
}

function messages(artifact) {
  const match = artifact.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'the standalone artifact embeds its Viewer messages');
  return JSON.parse(match[1]);
}

test('ERD accepts partial translations through validate, render and deliver', t => {
  const directory = workspace(t);
  const document = fixture({ 'viewer.common.close': 'Dismiss panel' });
  const english = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/en.json'), 'utf8'));
  for (const command of ['validate', 'render', 'deliver']) {
    const result = run(directory, document, command);
    assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
    if (command !== 'render') assert.equal(JSON.parse(result.stdout).ok, true);
    if (command === 'validate') continue;
    const artifact = html(directory);
    const embedded = messages(artifact);
    assert.equal(embedded.locale, 'en');
    assert.equal(embedded.messages['viewer.common.close'], 'Dismiss panel');
    assert.equal(embedded.messages['viewer.common.copyLink'], english['viewer.common.copyLink']);
    assert.match(artifact, /<html lang="en"/);
    assert.match(artifact, />Authored users<\/text>/);
    assert.match(artifact, />user_id<\/text>/);
    assert.match(artifact, />int<\/text>/);
  }
});

test('ERD renders a supplied cardinality legend and preserves authored names', t => {
  const directory = workspace(t);
  const document = fixture({ 'legend.erd.one': 'Exactly one', 'legend.erd.many': 'Several' }, 'xx');
  document.entities.push({
    id: 'accounts', label: 'Authored accounts', pos: [440, 80],
    attributes: [{ name: 'account_id', type: 'int', key: 'pk' }],
  });
  document.relationships = [{
    id: 'users_accounts', from: 'users', to: 'accounts',
    fromCardinality: 'many', toCardinality: 'one',
  }];
  const result = run(directory, document);
  assert.equal(result.status, 0, result.stderr);
  const artifact = html(directory);
  assert.equal(messages(artifact).locale, 'xx');
  assert.match(artifact, />Exactly one<\/text>/);
  assert.match(artifact, />Several<\/text>/);
  assert.match(artifact, />Authored users<\/text>/);
  assert.match(artifact, />Authored accounts<\/text>/);
});

test('ERD empty translations preserve locale-only artifacts byte for byte', t => {
  const directory = workspace(t);
  for (const locale of ['en', 'fr']) {
    const baseline = run(directory, fixture(undefined, locale));
    assert.equal(baseline.status, 0, baseline.stderr);
    const before = html(directory);
    const empty = run(directory, fixture({}, locale));
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(html(directory), before, locale);
  }
});

test('ERD unbundled translations retain supplied messages and disclose English fallback', t => {
  const directory = workspace(t);
  const result = run(directory, fixture({ 'viewer.common.close': 'Fermer' }, 'fr'));
  assert.equal(result.status, 0, result.stderr);
  const embedded = messages(html(directory));
  assert.equal(embedded.locale, 'fr');
  assert.equal(embedded.messages['viewer.common.close'], 'Fermer');
  const english = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/en.json'), 'utf8'));
  assert.equal(embedded.messages['viewer.common.copyLink'], english['viewer.common.copyLink']);
  assert.match(result.stderr, /fall back to English/);
});

test('ERD invalid override keys and placeholders keep bundled messages with diagnostics', t => {
  const directory = workspace(t);
  const document = fixture({
    'viewer.common.close': 'Dismiss {panel}',
    'viewer.common.closee': 'Unknown',
    'viewer.common.clear': 'Clear selection',
  });
  const validation = run(directory, document, 'validate');
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  const receipt = JSON.parse(validation.stdout);
  assert.ok(receipt.diagnostics.some(entry => entry.code === 'i18n/invalid-translation'));
  const result = run(directory, document);
  assert.equal(result.status, 0, result.stderr);
  const embedded = messages(html(directory));
  const english = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/en.json'), 'utf8'));
  assert.equal(embedded.messages['viewer.common.close'], english['viewer.common.close']);
  assert.equal(embedded.messages['viewer.common.clear'], 'Clear selection');
  assert.equal(embedded.messages['viewer.common.closee'], undefined);
  assert.match(result.stderr, /1 unknown, 1 placeholder mismatch/);
});

test('ERD malformed translations fail schema validation before publishing an artifact', t => {
  const directory = workspace(t);
  for (const translations of [null, [], 'invalid', { 'viewer.common.close': 42 }, { 'viewer.common.close': '' }]) {
    for (const command of ['validate', 'deliver']) {
      const result = run(directory, fixture(translations), command);
      assert.notEqual(result.status, 0);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.ok, false);
      assert.ok(receipt.diagnostics.some(entry => entry.subject?.path?.startsWith('/meta/translations')));
      assert.equal(fs.existsSync(path.join(directory, 'diagram.html')), false);
    }
  }
});
