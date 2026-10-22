import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the update code from the actual clean package. Keeping this gate
// separate lets notifier edge cases reuse it without replaying every renderer.
export async function verifyPackagedUpdateChecker(skillRoot, cacheDirectory) {
  const updateChecker = path.join(skillRoot, 'scripts', 'check-update.mjs');
  const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  const updateCheck = spawnSync(process.execPath, [updateChecker], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  if (updateCheck.status !== 0) {
    throw new Error(`packaged update checker failed with ${updateCheck.status}\n${updateCheck.stderr}`);
  }
  let updateReceipt;
  try {
    updateReceipt = JSON.parse(updateCheck.stdout);
  } catch {
    throw new Error('packaged update checker did not return valid JSON');
  }
  if (updateReceipt.status !== 'silent' || updateReceipt.reason !== 'disabled') {
    throw new Error('packaged update checker did not honor the local disable switch');
  }

  const checker = await import(pathToFileURL(updateChecker).href);
  const versionCore = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version);
  if (!versionCore) throw new Error('package version cannot produce an update-check smoke candidate');
  const candidateVersion = `${versionCore[1]}.${versionCore[2]}.${BigInt(versionCore[3]) + 1n}`;
  const candidate = {
    schemaVersion: 1,
    skillId: 'archify',
    channel: 'stable',
    version: candidateVersion,
    publishedAt: '2026-08-28T00:00:00Z',
    source: {
      repository: 'https://github.com/tt-a1i/archify',
      ref: `v${candidateVersion}`,
      treeSha: 'a'.repeat(40),
    },
    artifact: { sha256: 'b'.repeat(64) },
    summary: 'Package smoke candidate.',
    releaseNotes: `https://github.com/tt-a1i/archify/releases/tag/v${candidateVersion}`,
    severity: 'normal',
  };
  // The fork ships skill-release.json with updateChecks: false, so the packaged
  // checker must stay silent and never fetch. The notifier machinery is then
  // exercised against a copy of the release file without that flag.
  const shippedReceipt = await checker.checkForUpdate({
    cacheDirectory,
    fetchImpl: async () => { throw new Error('the shipped release identity must not fetch'); },
    now: () => Date.parse('2026-08-28T00:00:00Z'),
    random: () => 0.5,
  });
  if (shippedReceipt.status !== 'silent' || shippedReceipt.reason !== 'disabled') {
    throw new Error(`packaged update checker is not disabled by skill-release.json: ${JSON.stringify(shippedReceipt)}`);
  }
  const shippedRelease = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8'));
  delete shippedRelease.updateChecks;
  const enabledReleasePath = path.join(cacheDirectory, 'enabled-skill-release.json');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(enabledReleasePath, `${JSON.stringify(shippedRelease, null, 2)}\n`);
  const notifierReceipt = await checker.checkForUpdate({
    releasePath: enabledReleasePath,
    cacheDirectory,
    fetchImpl: async () => new Response(JSON.stringify(candidate), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"package-smoke"' },
    }),
    now: () => Date.parse('2026-08-28T00:00:00Z'),
    random: () => 0.5,
  });
  if (notifierReceipt.status !== 'update_available') {
    throw new Error(`packaged update checker did not return an update candidate: ${JSON.stringify(notifierReceipt)}`);
  }
  const notifierSnooze = await checker.setUpdatePreference({
    releasePath: enabledReleasePath,
    cacheDirectory,
    eventKey: notifierReceipt.eventKey,
    mode: 'snooze',
    now: () => Date.parse('2026-08-28T00:00:01Z'),
  });
  if (notifierSnooze.status !== 'snoozed') {
    throw new Error('packaged update checker did not persist an explicit snooze');
  }

  return { candidateVersion, notifierReceipt };
}
