import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-svg-path-checker-'));
const deadlineMs = process.platform === 'win32' ? 10000 : 3000;
let sequence = 0;
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// The public CLI starts the checker again; a timeout must end our entire process tree.
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && child.exitCode === null) {
      throw new Error(`taskkill failed: ${result.stderr || result.stdout}`);
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

async function check(t, body, { publicCli = false, rootAttrs = '', profile = 'showcase' } = {}) {
  const file = path.join(scratch, `${sequence++}.html`);
  fs.writeFileSync(file, `<!doctype html><html><body><svg viewBox="0 0 400 250" data-quality-profile="${profile}" ${rootAttrs}>${body}</svg></body></html>`);
  const args = publicCli ? [cli, 'check', file, '--json'] : [checker, file];
  return execute(t, args, body);
}

async function execute(t, args, description, timeoutMs = deadlineMs) {
  const child = spawn(process.execPath, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  let stdout = '', stderr = '', timedOut = false, exited = false, spawnError, cleanupError;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    exited = true;
    resolve({ code, signal });
  }));
  const timer = setTimeout(() => {
    timedOut = true;
    try { killTree(child); } catch (error) { cleanupError = error; }
  }, timeoutMs);
  t.after(async () => {
    clearTimeout(timer);
    if (!exited) killTree(child);
    await closed;
  });
  const result = await closed;
  clearTimeout(timer);
  assert.ifError(spawnError);
  assert.ifError(cleanupError);
  assert.equal(timedOut, false, `\u8def\u5f84\u68c0\u67e5\u5728 ${timeoutMs}ms \u5185\u672a\u9000\u51fa\uff0c\u5df2\u7ec8\u6b62\u8fdb\u7a0b\u6811\uff1a${description}`);
  assert.equal(result.signal, null, stderr);
  assert.ok(stdout.trim(), `\u8def\u5f84\u68c0\u67e5\u5fc5\u987b\u8fd4\u56de JSON \u56de\u6267\uff1a${stderr}`);
  return { ...result, receipt: JSON.parse(stdout), stderr };
}

function arrow(d, { id = 'route', from = 'a', to = 'b', extra = '' } = {}) {
  return `<path id="${id}" data-edge-id="${id}" data-edge-from="${from}" data-edge-to="${to}" d="${d}" class="a-default" marker-end="url(#arrowhead)" ${extra}/>`;
}

const normalChecks = ['single_svg', 'finite_svg', 'orthogonal_arrows', 'label_route_clearance',
  'relationship_crossings', 'relationship_corridors', 'container_border_runs', 'route_rhythm', 'legend_clearance'];
function assertPass(result) {
  assert.equal(result.code, 0, JSON.stringify(result.receipt));
  assert.equal(result.receipt.ok, true);
  assert.deepEqual(result.receipt.checks.map(item => item.name), normalChecks, '\u6b63\u5e38\u4ea7\u7269\u4ecd\u4fdd\u7559\u539f\u6709\u4e5d\u9879\u68c0\u67e5');
}
function assertPathError(result, code, { role = 'relationship', pathIndex = 1, id = 'route' } = {}) {
  assert.equal(result.code, 1, JSON.stringify(result.receipt));
  assert.equal(result.receipt.ok, false);
  assert.equal(result.receipt.checks.find(item => item.name === 'svg_path_data')?.ok, false);
  const diagnostic = result.receipt.diagnostics?.find(item => item.code === code);
  assert.ok(diagnostic, JSON.stringify(result.receipt));
  assert.equal(diagnostic.subject.role, role);
  assert.equal(diagnostic.subject.pathIndex, pathIndex);
  assert.equal(diagnostic.subject.id, id);
  assert.ok(Number.isInteger(diagnostic.evidence.tokenOffset) && diagnostic.evidence.tokenOffset >= 0);
  assert.ok(diagnostic.evidence.reason);
  assert.ok(diagnostic.supportedFixes.length > 0);
}

for (const d of [
  'M 20', 'M 20 20 Q 30 30 40', 'M 20 20 L 100', 'M 20 20 L 100 M 200 20',
  'M 20 NaN', 'M 20 20 L 1e999 30', 'M 20 20 X 100 20', 'M 20 20 Z 7', 'M20 20L40,,20',
]) {
  test(`\u7f3a\u5931\u3001\u672a\u77e5\u6216\u975e\u6709\u9650\u8def\u5f84\u6570\u636e\u4ee5\u8bca\u65ad\u7ed3\u675f\uff1a${d}`, async t => {
    assertPathError(await check(t, arrow(d)), 'artifact/svg-path-malformed');
  });
}
for (const d of ['M20 20A40 40 0 0 1 100 100', 'M20 20C40 20 60 20 100 20']) {
  test(`\u5408\u6cd5\u4f46\u672a\u652f\u6301\u7684\u6307\u4ee4\u4e0d\u80fd\u88ab\u5f53\u4f5c\u5176\u4ed6\u6307\u4ee4\u7ee7\u7eed\u8bfb\u53d6\uff1a${d}`, async t => {
    assertPathError(await check(t, arrow(d)), 'artifact/svg-path-unsupported');
  });
}

test('\u516c\u5171 check CLI \u6709\u754c\u8fd4\u56de\u8def\u5f84\u8bca\u65ad\uff0c\u4e0d\u9057\u7559\u5176 checker \u5b50\u8fdb\u7a0b', async t => {
  const result = await check(t, arrow('M20 20Q40 40 80'), { publicCli: true });
  assertPathError(result, 'artifact/svg-path-malformed');
});

test('\u8def\u5f84\u8bca\u65ad\u5b9a\u4f4d\u5b9e\u9645 path \u5143\u7d20\u5e76\u4fdd\u7559\u53ef\u4fee\u590d\u7684\u547d\u4ee4\u4fe1\u606f', async t => {
  const decoration = '<path d="M0 0C1 1 2 2 3 3"/>';
  const result = await check(t, decoration + arrow('M20 20A40 40 0 0 1 100 100'));
  assertPathError(result, 'artifact/svg-path-unsupported', { pathIndex: 2 });
  assert.equal(result.receipt.diagnostics.find(item => item.code === 'artifact/svg-path-unsupported').evidence.command, 'A');
  assert.equal(result.receipt.diagnostics.find(item => item.code === 'artifact/svg-path-unsupported').evidence.tokenOffset, 6);
});

test('\u5927\u5c0f\u5199\u6307\u6570\u3001\u5c0f\u6570\u3001\u9690\u5f0f\u91cd\u590d\u548c\u76f8\u5bf9\u5750\u6807\u4fdd\u7559\u540c\u4e00\u6761\u5b9e\u9645\u76f4\u7ebf', async t => {
  const forms = ['M20 20L200 20', 'M2E1,2e1 2e2,2E1', 'm20 20h1.8e2',
    'M+20.0 +20.L2.0e2 20.', 'M20 20h80 100', 'M&#x20;20&#32;20H200'];
  let metrics;
  for (const d of forms) {
    const result = await check(t, arrow(d));
    assertPass(result);
    const actual = result.receipt.composition.metrics;
    if (!metrics) metrics = actual;
    assert.equal(actual.properCrossings, 0);
    assert.equal(actual.maxBends, 0);
    assert.equal(actual.minSegmentPx, metrics.minSegmentPx);
  }
});

test('\u6b63\u5e38\u4e8c\u6b21\u66f2\u7ebf\u7ee7\u7eed\u53d7\u68c0\uff0c\u4e0d\u80fd\u4e3a\u62d2\u7edd\u5176\u4ed6\u66f2\u7ebf\u800c\u7981\u6b62\u5df2\u6709 Q', async t => {
  assertPass(await check(t, arrow('M20 20L80 20Q100 20 100 40L100 120')));
  assertPass(await check(t, arrow('m20 20l60 0q20 0 20 20v80')));
});

test('readable-v2 \u7684\u5706\u89d2\u524d\u540e\u76f4\u7ebf\u4e0d\u751f\u6210\u865a\u5047\u8de8\u8d8a\uff0c\u91c7\u6837\u70b9\u4e0d\u6210\u4e3a\u5fae\u7ebf\u6bb5', async t => {
  const rounded = arrow('M20 20L80 20Q100 20 100 40L100 120');
  const other = arrow('M50 70H96', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' });
  const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Clear"><rect class="c-mask" x="84" y="64" width="8" height="12"/></g>';
  const result = await check(t, rounded + other + label, {
    publicCli: true, rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assertPass(result);
  const metrics = result.receipt.composition.metrics;
  assert.equal(metrics.properCrossings, 0);
  assert.equal(metrics.labelRouteClearanceIssues, 0);
  assert.equal(metrics.maxBends, 0);
  assert.equal(metrics.minSegmentPx, 46);
  assert.equal(metrics.microSegmentCount, 0);
});

test('readable-v2 \u4ecd\u68c0\u51fa\u5706\u89d2\u540e\u53ef\u89c1\u76f4\u7ebf\u4e0a\u7684\u771f\u5b9e\u4ea4\u53c9', async t => {
  const result = await check(t, arrow('M20 20L80 20Q100 20 100 40L100 120')
    + arrow('M92 70H160', { id: 'other', from: 'c', to: 'd' }), {
    publicCli: true, rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assert.equal(result.code, 1);
  assert.equal(result.receipt.checks.find(item => item.name === 'relationship_crossings').ok, false);
  assert.deepEqual(result.receipt.composition.issues.find(item => item.code === 'composition/proper-crossing').point, [100, 70]);
});

const disconnected = 'M20 20L100 20M100 100L200 100';
const acrossGap = arrow('M80 60L120 60', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' });
for (const rootAttrs of ['', 'data-layout-contract="readable-v2"']) {
  test(`\u591a\u4e2a M \u4e0d\u4ea7\u751f\u865a\u6784\u7684\u4ea4\u53c9\u3001\u8f6c\u5f2f\u6216\u906e\u6321\uff1a${rootAttrs || 'legacy'}`, async t => {
    const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Gap label"><rect class="c-mask" x="90" y="50" width="20" height="20"/></g>';
    const result = await check(t, arrow(disconnected) + acrossGap + label, { rootAttrs });
    assertPass(result);
    const metrics = result.receipt.composition.metrics;
    assert.equal(metrics.properCrossings, 0);
    assert.equal(metrics.labelRouteClearanceIssues, 0);
    assert.equal(metrics.maxBends, 0);
    assert.equal(metrics.microSegmentCount, 0);
  });
  test(`\u8def\u5f84\u5143\u6570\u636e\u4e0d\u80fd\u8de8\u8d8a\u53ef\u89c1\u5b50\u8def\u5f84\u65ad\u70b9\uff1a${rootAttrs || 'legacy'}`, async t => {
    const metadata = 'data-composition-points="20,20;100,20;100,100;200,100"';
    const result = await check(t, arrow(disconnected, { extra: metadata }) + acrossGap, { rootAttrs });
    assertPass(result);
    assert.equal(result.receipt.composition.metrics.maxBends, 0);
  });
  test(`\u771f\u5b9e\u8fde\u7eed\u8def\u5f84\u4ea4\u53c9\u4ecd\u7136\u5931\u8d25\uff1a${rootAttrs || 'legacy'}`, async t => {
    const result = await check(t, arrow('M20 20L100 20L100 100L200 100') + acrossGap, { rootAttrs });
    assert.equal(result.code, 1);
    assert.equal(result.receipt.checks.find(item => item.name === 'relationship_crossings').ok, false);
    assert.deepEqual(result.receipt.composition.issues.find(item => item.code === 'composition/proper-crossing').point, [100, 60]);
  });
}

test('Z \u56de\u5230\u5f53\u524d\u5b50\u8def\u5f84\u8d77\u70b9\uff0c\u540e\u7eed\u76f8\u5bf9 m \u4e0d\u6cbf\u65e7\u7ec8\u70b9\u79fb\u52a8', async t => {
  const d = 'M20 20H100V100H20Z m0 120h60';
  const other = arrow('M10 180H30', { id: 'other', from: 'c', to: 'd' });
  const result = await check(t, arrow(d) + other);
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.properCrossings, 0);
});

test('\u6bcf\u4e2a\u65b0 M \u90fd\u91cd\u7f6e\u5173\u95ed\u70b9\uff0c\u4e24\u4e2a\u6b63\u4ea4\u95ed\u5408\u5b50\u8def\u5f84\u4e0d\u4f1a\u51fa\u73b0\u5bf9\u89d2\u7ebf', async t => {
  assertPass(await check(t, arrow('M20 20H100V60H20Z M160 20H240V60H160Z')));
});

test('\u5173\u95ed\u8def\u5f84\u540e\u7ee7\u7eed\u7684\u76f8\u5bf9\u7ed8\u5236\u4f7f\u7528\u5173\u95ed\u70b9\uff0c\u4ecd\u80fd\u53d1\u73b0\u771f\u5b9e\u4ea4\u53c9', async t => {
  const body = arrow('M20 20H100V100H20Z m0 120h60')
    + arrow('M60 130V150', { id: 'other', from: 'c', to: 'd' });
  const result = await check(t, body);
  assert.equal(result.code, 1);
  assert.deepEqual(result.receipt.composition.issues.find(item => item.code === 'composition/proper-crossing').point, [60, 140]);
});

test('\u5408\u6cd5 metadata \u4e0d\u80fd\u4f7f\u6b8b\u7f3a\u8def\u5f84\u7ed5\u8fc7\u8bed\u6cd5\u68c0\u67e5', async t => {
  const result = await check(t, arrow('M20', { extra: 'data-composition-points="20,20;200,20"' }), {
    rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assertPathError(result, 'artifact/svg-path-malformed');
});

test('\u7ed3\u6784\u6846\u7684\u6b8b\u7f3a\u8def\u5f84\u8fd4\u56de\u72ec\u7acb\u5b9a\u4f4d\uff0c\u4e0d\u5728\u7b2c\u4e8c\u4e2a\u89e3\u6790\u5165\u53e3\u6302\u8d77', async t => {
  const frame = '<path id="outline" data-composition-frame-kind="group" data-composition-frame-id="group-a" d="M20 20Q40 40 80"/>';
  assertPathError(await check(t, frame), 'artifact/svg-path-malformed', { role: 'structural-frame', id: 'outline' });
});

test('\u7ed3\u6784\u6846\u5b50\u8def\u5f84\u4e4b\u95f4\u7684\u7a7a\u9699\u4e0d\u4ea7\u751f\u8fb9\u6846\u91cd\u5408\uff0c\u771f\u5b9e\u8fb9\u6846\u4ecd\u4f1a\u5931\u8d25', async t => {
  const makeFrame = d => `<path data-composition-frame-kind="group" data-composition-frame-id="group-a" d="${d}"/>`;
  const relation = arrow('M120 40H180');
  assertPass(await check(t, makeFrame('M40 40H100 M200 40H280') + relation));
  const crossing = await check(t, makeFrame('M40 40H280') + relation);
  assert.equal(crossing.code, 1);
  assert.equal(crossing.receipt.checks.find(item => item.name === 'container_border_runs').ok, false);
});

test('\u56fe\u6807\u3001\u54c1\u724c\u4e0e\u666e\u901a\u88c5\u9970\u4e2d\u7684 A/C \u4e0d\u6269\u5927\u68c0\u67e5\u5668\u7684\u8def\u5f84\u8303\u56f4', async t => {
  const decorations = `<g data-node-icon="cloud"><path d="M0 0A4 4 0 0 1 8 0"/></g>
    <g data-node-brand="example"><path d="M0 0C1 1 2 2 3 3"/></g>
    <path class="a-default" d="M20 20A40 40 0 0 1 100 100"/>
    <path marker-end="url(#arrowhead)" d="M20 20C40 20 60 20 100 20"/>`;
  assertPass(await check(t, decorations + arrow('M20 20H200')));
});


test('\u591a\u5b50\u8def\u5f84\u7684\u9884\u7b97\u6309\u8fde\u7eed\u7247\u6bb5\u6d4b\u91cf\uff0c\u540c\u4e00\u5173\u7cfb\u8d85\u9884\u7b97\u53ea\u8ba1\u4e00\u6b21', async t => {
  const result = await check(t, arrow('M20 20H60V60H100V100 M160 20H200V60H240V100'));
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.maxBends, 6);
  assert.equal(result.receipt.composition.metrics.routesOverSuggestedBends, 1);
});

test('\u540e\u7eed\u5b50\u8def\u5f84\u4ecd\u53c2\u4e0e\u6807\u7b7e\u906e\u6321\uff0c\u4e0d\u80fd\u88ab\u5173\u7cfb ID \u53bb\u91cd\u4e22\u5f03', async t => {
  const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Label"><rect class="c-mask" x="130" y="90" width="20" height="20"/></g>';
  const result = await check(t, arrow('M20 20H60 M100 100H200')
    + arrow('M90 200H210', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' }) + label);
  assert.equal(result.code, 1);
  const issue = result.receipt.composition.issues.find(item => item.code === 'composition/label-route-clearance');
  assert.equal(issue.otherRelationship.id, 'route');
  assert.equal(issue.segmentIndex, 1);
});

test('\u591a\u5b50\u8def\u5f84\u53ea\u4ee5\u771f\u5b9e\u6700\u540e\u4e00\u6bb5\u68c0\u6d4b marker-end\uff0c\u65e9\u671f\u7247\u6bb5\u4e0d\u4ea7\u751f\u865a\u5047\u7bad\u5934\u76f8\u649e', async t => {
  const result = await check(t, arrow('M20 20H100 M20 100H150', { from: 'a', to: 'end' })
    + arrow('M20 21H100 M20 150H150', { id: 'other', from: 'b', to: 'end' }), {
    rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.arrowheadCollisions, 0);
});

test('\u672b\u5c3e\u4ec5\u6709 M \u7684\u5b50\u8def\u5f84\u4e0d\u628a\u65e9\u671f\u76f4\u7ebf\u5f53\u4f5c\u6700\u7ec8\u7bad\u5934', async t => {
  const result = await check(t, arrow('M20 20H100 M200 100', { from: 'a', to: 'end' })
    + arrow('M20 21H100 M200 200', { id: 'other', from: 'b', to: 'end' }), {
    publicCli: true, rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.arrowheadCollisions, 0);
});

for (const [name, left, right, from, to, passes] of [
  ['\u5b9e\u9645 source', 'M20 20H40V60 M100 100H140', 'M20 20H40V0 M180 100H220', 'a', 'other-end', true],
  ['\u5185\u90e8 source', 'M20 20H60 M100 100H120V140', 'M20 60H60 M100 100H120V60', 'a', 'other-end', false],
  ['\u5b9e\u9645 target', 'M20 20H60 M100 100H120', 'M20 60H60 M100 80V100H120', 'other-start', 'b', true],
  ['\u5185\u90e8 target', 'M100 100H120 M200 20H240', 'M100 80V100H120 M200 60H240', 'other-start', 'b', false],
]) {
  test(`workflow \u77ed\u5171\u4eab\u7ebf\u4f8b\u5916\u4f7f\u7528 ${name} \u800c\u975e\u4efb\u610f\u5b50\u8def\u5f84\u9996\u5c3e`, async t => {
    const result = await check(t, arrow(left) + arrow(right, { id: 'other', from, to }), {
      rootAttrs: 'data-layout-contract="readable-v2"',
    });
    if (passes) assertPass(result);
    else {
      assert.equal(result.code, 1);
      assert.equal(result.receipt.checks.find(item => item.name === 'relationship_corridors').ok, false);
      assert.equal(result.receipt.composition.metrics.ambiguousCorridors, 1);
    }
  });
}

test('\u6ce8\u91ca\u3001CDATA \u548c\u5c5e\u6027\u6587\u672c\u4e2d\u7684\u4f2a\u8def\u5f84\u4e0d\u53c2\u4e0e\u4e25\u683c\u89e3\u6790\u6216\u8def\u5f84\u7f16\u53f7', async t => {
  const fake = '<path class="a-default" marker-end="url(#arrowhead)" d="M20 20X100 20"/>';
  const frame = '<path data-composition-frame-kind="group" d="M20"/>';
  const ignored = `<!-- ${fake}${frame} --> <![CDATA[${fake}${frame}]]><g data-example='${fake}${frame}'></g>`;
  assertPass(await check(t, ignored + arrow('M20 20H200')));
  assertPathError(await check(t, ignored + arrow('M20')), 'artifact/svg-path-malformed');
});

test('\u591a\u5b50\u8def\u5f84\u6a21\u5f0f\u4ecd\u5bf9\u540c\u4e00\u5173\u7cfb\u7684\u91cd\u590d SVG \u7247\u6bb5\u53ea\u8ba1\u7b97\u4e00\u6b21\u6807\u7b7e\u906e\u6321', async t => {
  const duplicate = arrow('M20 100H200', { extra: 'data-edge-key="0"' });
  const other = arrow('M90 200H210', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' });
  const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Label"><rect class="c-mask" x="130" y="90" width="20" height="20"/></g>';
  const trigger = arrow('M20 220H60 M100 220H200', { id: 'disjoint', from: 'e', to: 'f' });
  const base = await check(t, duplicate + duplicate + other + label);
  const multi = await check(t, duplicate + duplicate + other + label + trigger);
  assert.equal(base.receipt.composition.metrics.labelRouteClearanceIssues, 1);
  assert.equal(multi.receipt.composition.metrics.labelRouteClearanceIssues, 1);
});

test('\u6bcf\u7247\u6bb5\u5404\u4e24\u6b21\u8f6c\u5f2f\u4ecd\u7d2f\u8ba1\u4e3a\u539f\u5173\u7cfb\u7684\u56db\u4e2a\u771f\u5b9e\u8f6c\u5f2f', async t => {
  const result = await check(t, arrow('M20 20H100V60H180 M220 20H300V60H380'));
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.maxBends, 4);
  assert.equal(result.receipt.composition.metrics.routesOverSuggestedBends, 1);
});

test('deliver \u4fdd\u7559\u8def\u5f84\u8bca\u65ad\u5e76\u4e14\u4e0d\u8986\u76d6\u6b64\u524d\u5b58\u5728\u7684 HTML', async t => {
  const output = path.join(scratch, 'previous.html');
  const wrapper = path.join(scratch, 'broken-renderer.mjs');
  const previous = Buffer.from('<!doctype html><p>previous trusted artifact</p>');
  fs.writeFileSync(output, previous);
  // Corrupt the artifact only after the renderer finished writing it; delivery, check, receipt and rollback all go through the production entry point.
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  const result = original(command, args, options);
  if (String(args?.[0]).endsWith('render-architecture.mjs') && result.status === 0) {
    const html = fs.readFileSync(args[2], 'utf8');
    let replaced = false;
    const broken = html.replace(/<path\\b[^>]*>/g, tag => {
      if (replaced || !/class="[^"]*\\ba-(?:default|emphasis|security|dashed)\\b/.test(tag) || !tag.includes('marker-end=')) return tag;
      replaced = true;
      return tag.replace('<path ', '<path id="injected-path" ').replace(/\\bd="[^"]*"/, 'd="M20 20A40 40 0 0 1 100 100"');
    });
    if (!replaced) throw new Error('fixture did not find a rendered arrow');
    fs.writeFileSync(args[2], broken);
  }
  return result;
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'architecture',
  ${JSON.stringify(path.join(skillRoot, 'examples/web-app.architecture.json'))}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = await execute(t, [wrapper], 'deliver with an unsupported rendered path', deadlineMs * 5);
  assert.equal(result.code, 1, JSON.stringify(result.receipt));
  assert.equal(result.receipt.stage, 'check');
  assert.equal(result.receipt.ok, false);
  const issue = result.receipt.diagnostics.find(item => item.code === 'artifact/svg-path-unsupported');
  assert.ok(issue, JSON.stringify(result.receipt));
  assert.equal(issue.subject.id, 'injected-path');
  assert.equal(issue.subject.role, 'relationship');
  assert.ok(issue.subject.pathIndex >= 1);
  assert.equal(issue.evidence.command, 'A');
  assert.equal(issue.evidence.tokenOffset, 6);
  assert.ok(issue.supportedFixes.length > 0);
  assert.deepEqual(fs.readFileSync(output), previous);
});
