#!/usr/bin/env node
// Re-render every checked-in example artifact from its tracked source so the
// golden checks (test/golden.mjs, test/architecture-delta.test.mjs) see the
// current template and renderers. Upstream regenerates these by hand; the fork
// runs this after every viewer, renderer or example change and after merging an
// upstream release. See FORK.md.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');

function run(args, cwd = repoRoot) {
  execFileSync(process.execPath, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

// Bundled examples: the packaged copies beside their JSON and the golden copies
// under examples/ are the same bytes.
for (const outputRoot of [path.join(skillRoot, 'examples'), path.join(repoRoot, 'examples')]) {
  run([path.join(skillRoot, 'scripts/render-examples.mjs'), outputRoot]);
}

// Repository-level architecture showcases keep their own source next to them.
const topLevel = [
  ['examples/archify-repo.architecture.json', 'examples/archify-repo.html'],
  ['examples/archify-repo-grid.architecture.json', 'examples/archify-repo-grid.html'],
  ['examples/maka-architecture.architecture.json', 'examples/maka-architecture.html'],
  ['examples/rag-pipeline.architecture.json', 'examples/rag-pipeline.html'],
  ['archify/examples/web-app.architecture.json', 'examples/web-app.html'],
];
for (const [input, output] of topLevel) {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, input), 'utf8'));
  const quality = source.meta?.quality_profile || 'standard';
  run([cli, 'render', 'architecture', input, output, '--quality', quality]);
}

// The Architecture Delta proof and its receipt are rebuilt from the tracked
// base/head snapshots with the command documented in viewer/README.md.
run([
  cli, 'compare', 'architecture',
  'archify/examples/checkout-platform.base.architecture.json',
  'archify/examples/checkout-platform.head.architecture.json',
  'examples/checkout-platform-delta.html',
  '--receipt', 'examples/checkout-platform-delta.receipt.json',
  '--quality', 'showcase', '--json',
]);

console.log('re-rendered bundled examples, repository showcases and the checkout delta proof');
