import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

// The fork's release identity: archify/package.json carries
// <upstream core>-hadrian.<n>, every version-bearing surface agrees with it,
// the shipped release identity keeps the upstream update notifier off, and the
// upstream core names a published upstream release. See FORK.md.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const checker = path.join(repoRoot, 'scripts', 'check-release-identity.mjs');

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function runCheck(root) {
  return spawnSync(process.execPath, [checker, '--root', root], { encoding: 'utf8' });
}

function release(version, extra = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    skillId: 'archify',
    channel: version.includes('-hadrian.') ? 'hadrian' : 'stable',
    version,
    source: { repository: 'https://github.com/tt-a1i/archify' },
    updateManifestUrl: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
    updateChecks: false,
    ...extra,
  });
}

function writeValidFixture(root, overrides = {}) {
  const version = overrides.version || '2.13.0-hadrian.1';
  const core = version.split('-')[0];
  const escaped = version.replaceAll('-', '--');
  const readme = [
    `![Version](https://img.shields.io/badge/version-${escaped}-002548)`,
    '',
    `**Current version:** \`v${version}\`, built on upstream \`v${core}\`.`,
    '',
  ].join('\n');
  const template = `<!DOCTYPE html>\n<html>\n<head>\n  <meta name="generator" content="archify ${version}">\n</head>\n</html>\n`;
  const files = {
    'archify/package.json': JSON.stringify({ name: 'archify', version }),
    'archify/package-lock.json': JSON.stringify({ name: 'archify', version, packages: { '': { name: 'archify', version } } }),
    'archify/skill-release.json': release(version),
    'archify/SKILL.md': `---\nname: archify\nversion: "${core.split('.').slice(0, 2).join('.')}"\n---\n`,
    'archify/assets/template.html': template,
    'viewer/template.source.html': template,
    'README.md': readme,
    'FORK.md': `# Fork\n\nCurrent fork version \`${version}\`.\n`,
    'CHANGELOG.md': `# Changelog\n\n## [Unreleased]\n\n## [${core}] — 2026-07-29\n\n- Published.\n\n## [2.12.0] — 2026-07-01\n\n- Earlier.\n`,
    ...overrides.files,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    if (content !== null) writeFile(root, relativePath, content);
  }
  return version;
}

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the repository passes its own release identity check', () => {
  const result = runCheck(repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'archify/package.json'), 'utf8')).version;
  assert.match(version, /^\d+\.\d+\.\d+-hadrian\.[1-9]\d*$/);
  assert.match(result.stdout, new RegExp(`release identity ok: ${version.replaceAll('.', '\\.')}`));
});

test('a coherent fork identity passes', () => {
  withFixture((root) => {
    writeValidFixture(root);
    const result = runCheck(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

test('a plain upstream stable version is accepted when every surface agrees', () => {
  withFixture((root) => {
    const version = '2.13.0';
    writeValidFixture(root, { version, files: {
      'README.md': `![Version](https://img.shields.io/badge/version-${version}-002548)\n\n**Current version:** \`v${version}\`.\n`,
    } });
    const result = runCheck(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

test('the hadrian counter starts at one and rejects other prerelease identifiers', () => {
  for (const version of ['2.13.0-hadrian.0', '2.13.0-hadrian', '2.13.0-dev.1', '2.13.0-hadrian.1.2', '2.13.0+build']) {
    withFixture((root) => {
      writeValidFixture(root, { version });
      const result = runCheck(root);
      assert.notEqual(result.status, 0, version);
      assert.match(result.stderr, /not a supported fork identity/, version);
    });
  }
});

test('the upstream core must be a published upstream release', () => {
  withFixture((root) => {
    writeValidFixture(root, { version: '2.14.0-hadrian.1', files: {
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n- Not yet released upstream.\n\n## [2.13.0] — 2026-07-29\n\n- Published.\n',
    } });
    const result = runCheck(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package core 2\.14\.0 must name a published upstream release/);
  });
});

test('the shipped release identity must keep the update notifier off', () => {
  withFixture((root) => {
    const version = writeValidFixture(root);
    const enabled = JSON.parse(release(version));
    delete enabled.updateChecks;
    writeFile(root, 'archify/skill-release.json', JSON.stringify(enabled));
    const result = runCheck(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must set "updateChecks": false/);
  });
  withFixture((root) => {
    const version = writeValidFixture(root);
    writeFile(root, 'archify/skill-release.json', release(version, { channel: 'development' }));
    const result = runCheck(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /archify\/skill-release\.json/);
  });
});

test('package, lockfile, Skill metadata, templates, README and FORK.md share one identity', () => {
  const version = '2.13.0-hadrian.1';
  const drift = [
    ['archify/package-lock.json', JSON.stringify({ name: 'archify', version: '2.13.0-hadrian.2', packages: { '': { name: 'archify', version: '2.13.0-hadrian.2' } } }), /package-lock\.json must match/],
    ['archify/SKILL.md', '---\nname: archify\nversion: "2.12"\n---\n', /SKILL\.md metadata version/],
    ['archify/assets/template.html', '<meta name="generator" content="archify 2.13.0">', /archify\/assets\/template\.html generator must be archify 2\.13\.0-hadrian\.1/],
    ['viewer/template.source.html', '<meta name="generator" content="archify 2.13.0-hadrian.2">', /viewer\/template\.source\.html generator/],
    ['README.md', `![Version](https://img.shields.io/badge/version-2.13.0-002548)\n\n**Current version:** \`v${version}\`, built on upstream \`v2.13.0\`.\n`, /exact escaped badge/],
    ['README.md', `![Version](https://img.shields.io/badge/version-2.13.0--hadrian.1-002548)\n\n**Current version:** \`v${version}\`.\n`, /built on upstream/],
    ['FORK.md', '# Fork\n\nCurrent fork version `2.13.0-hadrian.2`.\n', /FORK\.md must record/],
  ];
  for (const [relativePath, content, expected] of drift) {
    withFixture((root) => {
      writeValidFixture(root, { version });
      writeFile(root, relativePath, content);
      const result = runCheck(root);
      assert.notEqual(result.status, 0, relativePath);
      assert.match(result.stderr, expected, relativePath);
    });
  }
});

test('version-bearing surfaces are reported together rather than stopping at the first drift', () => {
  withFixture((root) => {
    writeValidFixture(root);
    writeFile(root, 'archify/SKILL.md', '---\nname: archify\nversion: "2.12"\n---\n');
    writeFile(root, 'FORK.md', '# Fork\n');
    const result = runCheck(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SKILL\.md metadata version/);
    assert.match(result.stderr, /FORK\.md must record/);
  });
});
