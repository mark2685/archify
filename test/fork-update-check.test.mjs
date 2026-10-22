import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkForUpdate } from '../archify/scripts/check-update.mjs';
import { validateLocalRelease } from '../archify/scripts/update-contract.mjs';

// The fork turns the upstream update notifier off through the shipped release
// identity: deliveries never fetch upstream's manifest and never ask the user
// to install upstream over the fork. See FORK.md.

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');

test('the shipped release identity declares updateChecks: false', () => {
  const release = validateLocalRelease(JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8')));
  assert.equal(release.updateChecks, false);
  assert.equal(release.channel, 'hadrian');
});

test('the update checker stays silent and never fetches with the shipped identity', async (t) => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fork-update-'));
  t.after(() => fs.rmSync(cacheDirectory, { recursive: true, force: true }));
  let fetched = 0;
  const result = await checkForUpdate({
    cacheDirectory,
    fetchImpl: async () => { fetched += 1; throw new Error('must not fetch'); },
    now: () => Date.parse('2026-10-22T00:00:00Z'),
    random: () => 0.5,
  });
  assert.deepEqual(result, { status: 'silent', reason: 'disabled' });
  assert.equal(fetched, 0);
  assert.deepEqual(fs.readdirSync(cacheDirectory), [], 'a disabled check writes no cache state');
});

test('a delivery receipt reports the update check as unavailable and disabled', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fork-deliver-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const output = path.join(scratch, 'web-app.html');
  const result = spawnSync(process.execPath, [cli, 'deliver', 'architecture', input, output, '--json'], {
    cwd: scratch,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CACHE_DIRECTORY: path.join(scratch, 'cache') },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.update.status, 'unavailable');
  assert.equal(receipt.update.reason, 'disabled');
  assert.equal(receipt.update.noticeRequired, false);
  assert.doesNotMatch(result.stdout + result.stderr, /Would you like me to update Archify/);
});
