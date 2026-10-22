import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The fork is English-only (FORK.md). scripts/check-english-only.mjs is the
// gate; this test runs it on the repository and proves, on a throwaway
// repository, that it fails on CJK, Hangul, Cyrillic and Arabic text, accepts
// \uXXXX escapes, honours a reasoned allowlist and rejects a stale one.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(repoRoot, 'scripts', 'check-english-only.mjs');

function run(root) {
  return spawnSync(process.execPath, [checker, '--root', root], { encoding: 'utf8' });
}

function repository(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-english-only-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

test('the repository contains no non-English text outside the allowlist', () => {
  const result = run(repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /english-only ok/);
});

test('the allowlist stays short and every entry carries a reason', () => {
  const allowlist = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'english-only-allowlist.json'), 'utf8'));
  assert.ok(allowlist.entries.length <= 3, 'the allowlist is for vendored files, not a workaround');
  for (const entry of allowlist.entries) {
    assert.ok(fs.existsSync(path.join(repoRoot, entry.path)), `${entry.path} exists`);
    assert.ok(entry.reason.length >= 40, `${entry.path} explains itself`);
  }
});

test('the scan fails on non-English text in any tracked text file and names the line', (t) => {
  const samples = {
    'docs/guide.md': '# Guide\n\nUse the cache first.\n\n\u5148\u67e5\u7f13\u5b58\u3002\n',
    'src/labels.json': '{ "title": "\ud55c\uad6d\uc5b4 \uc6f9\uc571" }\n',
    'test/fixture.mjs': "export const label = '\u0417\u0430\u043f\u0440\u043e\u0441';\n",
    'archify/locales/ar.json': '{ "page.title": "\u0645\u062e\u0637\u0637" }\n',
  };
  for (const [file, content] of Object.entries(samples)) {
    const root = repository(t, { 'README.md': '# English\n', [file]: content });
    const result = run(root);
    assert.notEqual(result.status, 0, file);
    assert.match(result.stderr, new RegExp(`english-only: ${file.replace(/[./]/g, '\\$&')}:\\d+:\\d+:`), file);
  }
});

test('escaped code points, Latin diacritics and symbols pass', (t) => {
  const root = repository(t, {
    'README.md': '# Ångström, naïve, Ω, μs, → ·\n',
    'test/wide.test.mjs': "assert.equal(textUnits('\\u4e2d\\u6587'), 4);\n",
    'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xe4, 0xb8, 0xad]).toString('latin1'),
  });
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('an allowlist entry needs a reason, covers only its file, and must not go stale', (t) => {
  const cjk = '# \u4e2d\u6587\n';
  const withReason = repository(t, {
    'vendor/SKILL.md': cjk,
    'scripts/english-only-allowlist.json': JSON.stringify({ entries: [{ path: 'vendor/SKILL.md', reason: 'Vendored upstream file pinned to a commit; not edited by the fork.' }] }),
  });
  assert.equal(run(withReason).status, 0, run(withReason).stderr);

  const otherFile = repository(t, {
    'vendor/SKILL.md': cjk,
    'docs/other.md': cjk,
    'scripts/english-only-allowlist.json': JSON.stringify({ entries: [{ path: 'vendor/SKILL.md', reason: 'Vendored upstream file pinned to a commit; not edited by the fork.' }] }),
  });
  const otherResult = run(otherFile);
  assert.notEqual(otherResult.status, 0);
  assert.match(otherResult.stderr, /docs\/other\.md:1:3/);
  assert.doesNotMatch(otherResult.stderr, /vendor\/SKILL\.md:/);

  const noReason = repository(t, {
    'vendor/SKILL.md': cjk,
    'scripts/english-only-allowlist.json': JSON.stringify({ entries: [{ path: 'vendor/SKILL.md', reason: '' }] }),
  });
  const noReasonResult = run(noReason);
  assert.notEqual(noReasonResult.status, 0);
  assert.match(noReasonResult.stderr, /needs a reason/);

  const stale = repository(t, {
    'vendor/SKILL.md': '# English only now\n',
    'scripts/english-only-allowlist.json': JSON.stringify({ entries: [{ path: 'vendor/SKILL.md', reason: 'Vendored upstream file pinned to a commit; not edited by the fork.' }] }),
  });
  const staleResult = run(stale);
  assert.notEqual(staleResult.status, 0);
  assert.match(staleResult.stderr, /allowlist entry vendor\/SKILL\.md no longer has non-English text/);
});
