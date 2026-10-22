#!/usr/bin/env node
// Release identity for the Hadrian fork. The fork releases as
// <upstream core>-hadrian.<n>: the core names the upstream release the fork is
// built on and the hadrian counter the fork revision. Every surface that
// states a version must agree with archify/package.json, and the shipped
// release identity must keep the upstream update notifier off. See FORK.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORK_PRERELEASE_IDENTIFIER,
  compareSemver,
  isStableCoreVersion,
  parseSemver,
  releaseChannelForVersion,
  validateLocalRelease,
} from '../archify/scripts/update-contract.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootFlag = process.argv.indexOf('--root');
const repoRoot = rootFlag === -1 ? scriptRoot : path.resolve(process.argv[rootFlag + 1] || '');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch {
    fail(`${relativePath} is missing or unreadable.`);
    return '';
  }
}

function readJson(relativePath) {
  const source = read(relativePath);
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch {
    fail(`${relativePath} is not valid JSON.`);
    return {};
  }
}

function shieldEscape(value) {
  return value.replaceAll('_', '__').replaceAll('-', '--');
}

function isForkVersion(parsed) {
  return Boolean(parsed?.prerelease)
    && parsed.prerelease.length === 2
    && parsed.prerelease[0] === FORK_PRERELEASE_IDENTIFIER
    && /^[1-9]\d*$/.test(parsed.prerelease[1]);
}

const packageJson = readJson('archify/package.json');
const version = packageJson.version;
let parsedVersion = null;
try {
  parsedVersion = parseSemver(version);
} catch {
  // The consolidated error below owns package-version policy reporting.
}
const isFork = isForkVersion(parsedVersion);
const hasSupportedVersion = Boolean(parsedVersion && parsedVersion.build === null
  && (parsedVersion.prerelease === null || isFork));

if (!hasSupportedVersion) {
  fail(`package version is not a supported fork identity (X.Y.Z or X.Y.Z-${FORK_PRERELEASE_IDENTIFIER}.N): ${JSON.stringify(version)}`);
}

// CHANGELOG.md is upstream's record. The fork does not edit it; it only checks
// that the upstream core the fork names is a published upstream release.
const changelog = read('CHANGELOG.md');
const publishedLabels = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)]
  .map((match) => match[1])
  .filter((label) => label !== 'Unreleased');
for (const label of publishedLabels) {
  if (!isStableCoreVersion(label)) fail(`CHANGELOG published version is not stable SemVer: ${label}.`);
}
const stableLabels = publishedLabels.filter(isStableCoreVersion).sort((left, right) => compareSemver(right, left));
if (hasSupportedVersion) {
  const core = parsedVersion.core.join('.');
  if (!stableLabels.includes(core)) {
    fail(`package core ${core} must name a published upstream release from CHANGELOG.md (newest: ${stableLabels[0] || '(none)'}).`);
  }
}

if (hasSupportedVersion) {
  const release = readJson('archify/skill-release.json');
  try {
    const validated = validateLocalRelease(release);
    if (validated.version !== version) {
      fail(`archify/skill-release.json must identify archify ${version}; found ${validated.version}.`);
    }
    if (validated.channel !== releaseChannelForVersion(version)) {
      fail(`archify/skill-release.json channel must be ${releaseChannelForVersion(version)} for ${version}.`);
    }
    if (validated.updateChecks !== false) {
      fail('archify/skill-release.json must set "updateChecks": false so the fork never prompts for upstream updates.');
    }
  } catch (error) {
    fail(`archify/skill-release.json is not a valid release identity: ${error.message}`);
  }

  const lock = readJson('archify/package-lock.json');
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    fail(`archify/package-lock.json must match ${version} at the root and packages[""].`);
  }

  const skill = read('archify/SKILL.md');
  const skillVersion = skill.match(/^\s*version:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  const expectedSkillVersion = `${parsedVersion.core[0]}.${parsedVersion.core[1]}`;
  if (skillVersion !== expectedSkillVersion) {
    fail(`archify/SKILL.md metadata version ${skillVersion || '(missing)'} must map to package ${version} as ${expectedSkillVersion}.`);
  }

  for (const templatePath of ['viewer/template.source.html', 'archify/assets/template.html']) {
    const template = read(templatePath);
    const generatorVersions = [...template.matchAll(/<meta\s+name="generator"\s+content="archify\s+([^"]+)"\s*\/?>/g)]
      .map((match) => match[1]);
    if (generatorVersions.length !== 1 || generatorVersions[0] !== version) {
      fail(`${templatePath} generator must be archify ${version}; found ${generatorVersions.join(', ') || '(missing)'}.`);
    }
  }

  const readme = read('README.md');
  const badge = `/badge/version-${shieldEscape(version)}-`;
  const marker = readme.split('\n').some((line) => line.includes('**Current version:**') && line.includes(`\`v${version}\``));
  if (!readme.includes(badge) || !marker) {
    fail(`README.md must advertise v${version} with an exact escaped badge and a "Current version" marker.`);
  }
  if (isFork) {
    const core = parsedVersion.core.join('.');
    if (!readme.includes(`built on upstream \`v${core}\``)) {
      fail(`README.md must name the upstream release the fork is built on: built on upstream \`v${core}\`.`);
    }
  }

  const fork = read('FORK.md');
  if (fork && !fork.includes(`\`${version}\``)) {
    fail(`FORK.md must record the current fork version \`${version}\`.`);
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`release identity: ${message}`);
  process.exit(1);
}

console.log(`release identity ok: ${version}`);
