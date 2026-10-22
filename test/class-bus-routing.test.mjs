import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const epsilon = 0.0001;
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

function diagram(ordinaryKind = 'realization', mixedBuses = false) {
  return {
    schema_version: 1,
    diagram_type: 'class',
    meta: { title: 'Interface extension and use' },
    types: mixedBuses ? [
      { id: 'base', label: 'Base', kind: 'interface', row: 0, col: 1.5 },
      { id: 'left', label: 'Left', kind: 'interface', row: 1, col: 0 },
      { id: 'right', label: 'Right', kind: 'interface', row: 1, col: 1 },
      { id: 'impl', label: 'Impl', kind: 'class', row: 1, col: 2 },
      { id: 'other', label: 'Other', kind: 'class', row: 1, col: 3 },
    ] : [
      { id: 'base', label: 'Base', kind: 'interface', row: 0, col: 1 },
      { id: 'left', label: 'Left', kind: 'interface', row: 1, col: 0 },
      { id: 'right', label: 'Right', kind: 'interface', row: 1, col: 2 },
      { id: 'impl', label: 'Impl', kind: 'class', row: 2, col: 1 },
    ],
    relationships: [
      { id: 'left_extends', from: 'left', to: 'base', kind: 'inheritance' },
      { id: 'right_extends', from: 'right', to: 'base', kind: 'inheritance' },
      { id: 'impl_relation', from: 'impl', to: 'base', kind: ordinaryKind },
      ...(mixedBuses ? [{ id: 'other_relation', from: 'other', to: 'base', kind: 'realization' }] : []),
    ],
  };
}

function interleavedHierarchy() {
  const document = diagram('realization', true);
  document.types.find(({ id }) => id === 'right').col = 2;
  document.types.find(({ id }) => id === 'impl').col = 1;
  // The abstract implementation sits at the same height as the interface, so the inheritance and implementation routes cannot be told apart by node height.
  document.types.filter(({ id }) => id === 'impl' || id === 'other')
    .forEach((type) => { type.kind = 'abstract'; });
  return document;
}

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function render(t, document, quality = 'showcase') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-bus-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.class.json');
  const output = path.join(directory, 'output.html');
  const authoredInput = JSON.stringify(document);
  fs.writeFileSync(input, authoredInput);
  const validation = JSON.parse(run(['validate', 'class', input, '--quality', quality, '--json'], directory));
  assert.equal(validation.ok, true);
  run(['render', 'class', input, output, '--quality', quality], directory);
  const check = JSON.parse(run(['check', output, '--json'], directory));
  assert.equal(check.ok, true);
  assert.equal(fs.readFileSync(input, 'utf8'), authoredInput, '\u8def\u7531\u5f52\u4e00\u5316\u4e0d\u5f97\u6539\u5199\u4f5c\u8005\u8f93\u5165');
  assert.equal(check.composition.summary.errors, 0);
  const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, '\u6e32\u67d3\u7ed3\u679c\u5e94\u5305\u542b SVG');
  const viewBox = attrs(svg.match(/<svg\b[^>]*>/)[0]).viewBox.split(/[\s,]+/).map(Number);
  assert.equal(viewBox.length, 4);
  assert.ok(viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0, '\u753b\u5e03\u8303\u56f4\u5fc5\u987b\u6709\u6548');
  const [minX, minY, width, height] = viewBox;
  const routes = [...svg.matchAll(/<path\b[^>]*data-class-relationship=[^>]*>/g)]
    .map((match) => attrs(match[0])).filter((route) => route['data-edge-id'])
    .map((route) => ({
      id: route['data-edge-id'], from: route['data-edge-from'], to: route['data-edge-to'],
      kind: route['data-class-relationship'], attrs: route,
      points: route['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)),
    }));
  const boxes = new Map([...svg.matchAll(/<g\b[^>]*data-node-id="([^"]+)"[^>]*>[\s\S]*?<rect\b([^>]*)>/g)]
    .map((match) => {
      const rect = attrs(match[2]);
      return [match[1], Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Number(rect[key])]))];
    }));
  assert.equal(routes.length, document.relationships.length, '\u6240\u6709\u4f5c\u8005\u5173\u7cfb\u90fd\u5fc5\u987b\u4fdd\u7559');
  for (const authored of document.relationships) {
    const route = routes.find(({ id }) => id === authored.id);
    assert.ok(route, authored.id);
    assert.deepEqual([route.from, route.to, route.kind], [authored.from, authored.to, authored.kind]);
    for (const [x, y] of route.points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${route.id} \u8def\u5f84\u70b9\u5fc5\u987b\u6709\u9650`);
      assert.ok(x >= minX - epsilon && x <= minX + width + epsilon
        && y >= minY - epsilon && y <= minY + height + epsilon,
      `${route.id} \u7684\u8def\u5f84\u70b9 [${x}, ${y}] \u5fc5\u987b\u4f4d\u4e8e\u753b\u5e03\u5185\uff0c\u907f\u514d\u7ed5\u884c\u88ab\u88c1\u5207`);
    }
    assert.ok(onSide(route.points[0], boxes.get(route.from)), `${route.id} \u5fc5\u987b\u4ece\u6765\u6e90\u7c7b\u578b\u51fa\u53d1`);
    assert.ok(onSide(route.points.at(-1), boxes.get(route.to)), `${route.id} \u5fc5\u987b\u5230\u8fbe\u76ee\u6807\u7c7b\u578b`);
    const marker = route.attrs['marker-end'] || route.attrs['marker-start'];
    assert.match(marker, authored.kind === 'dependency' ? /cl-open/ : /cl-triangle/);
    assert.equal(/\bcl-dashed\b/.test(route.attrs.class), authored.kind !== 'inheritance');
  }
  return { svg, routes, boxes };
}

function onSide([x, y], box, side) {
  const withinX = x >= box.x - epsilon && x <= box.x + box.width + epsilon;
  const withinY = y >= box.y - epsilon && y <= box.y + box.height + epsilon;
  const sides = {
    left: withinY && Math.abs(x - box.x) < epsilon,
    right: withinY && Math.abs(x - box.x - box.width) < epsilon,
    top: withinX && Math.abs(y - box.y) < epsilon,
    bottom: withinX && Math.abs(y - box.y - box.height) < epsilon,
  };
  return side ? sides[side] : Object.values(sides).some(Boolean);
}

// Only positive-length overlap on the same straight line counts; an orthogonal crossing or a single shared point is not a shared corridor.
function overlapLength([a, b], [c, d]) {
  const horizontal = Math.abs(a[1] - b[1]) < epsilon && Math.abs(c[1] - d[1]) < epsilon;
  const vertical = Math.abs(a[0] - b[0]) < epsilon && Math.abs(c[0] - d[0]) < epsilon;
  if (!horizontal && !vertical) return 0;
  const axis = horizontal ? 0 : 1;
  if (Math.abs(a[1 - axis] - c[1 - axis]) >= epsilon) return 0;
  return Math.max(0, Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
    - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])));
}

function assertDistinctNotation(routes) {
  for (const [index, left] of routes.entries()) {
    for (const right of routes.slice(index + 1)) {
      if (left.kind === right.kind) continue;
      if (left.to === right.to) {
        const a = left.points.at(-1);
        const b = right.points.at(-1);
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 16 - epsilon,
          `${left.id} \u548c ${right.id} \u7684\u4e0d\u540c\u5173\u7cfb\u6807\u8bb0\u4e0d\u53ef\u91cd\u53e0`);
      }
      for (let i = 1; i < left.points.length; i += 1) {
        for (let j = 1; j < right.points.length; j += 1) {
          assert.ok(overlapLength([left.points[i - 1], left.points[i]], [right.points[j - 1], right.points[j]]) <= epsilon,
            `${left.id} \u548c ${right.id} \u4e0d\u53ef\u5171\u7528\u6b63\u957f\u5ea6\u7ebf\u6bb5\u800c\u6df7\u6dc6\u5173\u7cfb\u79cd\u7c7b`);
        }
      }
    }
  }
}

for (const quality of ['standard', 'showcase']) {
  for (const [name, document] of [
    ['bus plus realization', diagram('realization')],
    ['bus plus dependency', diagram('dependency')],
    ['inheritance and realization buses', diagram('realization', true)],
    ['interleaved interfaces and abstract implementations', interleavedHierarchy()],
  ]) {
    test(`class ${quality}: ${name} keeps different relationship notations distinct in either authored order`, (t) => {
      for (const reverse of [false, true]) {
        const candidate = structuredClone(document);
        if (reverse) candidate.relationships.reverse();
        const result = render(t, candidate, quality);
        assertDistinctNotation(result.routes);
      }
    });
  }
}

for (const quality of ['standard', 'showcase']) {
  for (const kind of ['dependency', 'realization']) {
    test(`class ${quality}: empty via keeps ${kind} fallback equivalent to omitted waypoints`, (t) => {
      for (const reverse of [false, true]) {
        const omitted = diagram(kind);
        if (reverse) omitted.relationships.reverse();
        const expected = render(t, omitted, quality);
        for (const selection of ['one', 'hierarchy', 'all']) {
          const document = structuredClone(omitted);
          const members = document.relationships.filter((relation) => selection === 'all' || relation.kind === 'inheritance');
          for (const relation of selection === 'one' ? members.slice(0, 1) : members) relation.via = [];
          const actual = render(t, document, quality);
          assertDistinctNotation(actual.routes);
          assert.equal(actual.svg, expected.svg, `${selection}: \u7a7a via \u4e0e\u7701\u7565\u5b57\u6bb5\u5e94\u6709\u76f8\u540c\u6e32\u67d3\u884c\u4e3a`);
        }
      }
    });
  }
}

for (const kind of ['inheritance', 'realization']) {
  test(`class: an isolated ${kind} hierarchy retains its shared bus`, (t) => {
    const document = diagram();
    document.types = document.types.filter(({ id }) => id !== 'impl');
    document.relationships = document.relationships.slice(0, 2).map((relation) => ({ ...relation, kind }));
    if (kind === 'realization') document.types.filter(({ id }) => id !== 'base').forEach((type) => { type.kind = 'class'; });
    const { routes } = render(t, document);
    assert.ok(routes.every((route) => route.attrs['data-class-bus'] === 'base'), '\u65e0\u51b2\u7a81\u7684\u540c\u7c7b\u5173\u7cfb\u4ecd\u5e94\u5171\u7528\u603b\u7ebf');
    assert.deepEqual(routes[0].points.at(-1), routes[1].points.at(-1), '\u540c\u7c7b\u603b\u7ebf\u4fdd\u7559\u540c\u4e00\u4e2a\u4e09\u89d2\u6807\u8bb0\u843d\u70b9');
  });
}

test('class: a separate storage hierarchy keeps its bus while another hierarchy is repaired', (t) => {
  const document = diagram('dependency');
  document.types.push(
    { id: 'storage', label: 'StoragePort', kind: 'interface', row: 3, col: 0.5 },
    { id: 'disk', label: 'DiskStore', kind: 'class', row: 4, col: 0 },
    { id: 'cloud', label: 'CloudStore', kind: 'class', row: 4, col: 1 },
  );
  document.relationships.push(
    { id: 'disk_storage', from: 'disk', to: 'storage', kind: 'realization' },
    { id: 'cloud_storage', from: 'cloud', to: 'storage', kind: 'realization' },
  );
  for (const reverse of [false, true]) {
    const candidate = structuredClone(document);
    if (reverse) candidate.relationships.reverse();
    const { routes } = render(t, candidate);
    assertDistinctNotation(routes);
    const storage = routes.filter(({ to }) => to === 'storage');
    assert.ok(storage.every((route) => route.attrs['data-class-bus'] === 'storage'),
      '\u72ec\u7acb\u7684\u540c\u7c7b\u603b\u7ebf\u4e0d\u5e94\u56e0\u522b\u5904\u7684\u7ebf\u8def\u51b2\u7a81\u800c\u62c6\u6563');
    assert.deepEqual(storage[0].points.at(-1), storage[1].points.at(-1));
  }
});

for (const [control, emptyVia] of ['via', 'sides', 'route', 'labelAt']
  .flatMap((control) => (control === 'via' ? [[control, false]] : [[control, false], [control, true]]))) {
  test(`class: bus coordination preserves authored ${control}${emptyVia ? ' with empty via' : ''}`, (t) => {
    const document = diagram('dependency');
    const relation = document.relationships.at(-1);
    if (emptyVia) relation.via = [];
    if (control === 'via') {
      Object.assign(relation, { fromSide: 'right', toSide: 'right', via: [[584, 313], [584, 62]] });
    } else if (control === 'sides') {
      Object.assign(relation, { fromSide: 'right', toSide: 'right' });
    } else if (control === 'route') {
      Object.assign(relation, { route: 'straight', fromSide: 'top', toSide: 'bottom' });
    } else {
      Object.assign(relation, { label: 'uses', labelAt: [600, 300] });
    }
    const { svg, routes, boxes } = render(t, document);
    const route = routes.find(({ id }) => id === relation.id);
    if (relation.fromSide) assert.ok(onSide(route.points[0], boxes.get(relation.from), relation.fromSide));
    if (relation.toSide) assert.ok(onSide(route.points.at(-1), boxes.get(relation.to), relation.toSide));
    if (relation.via?.length) assert.deepEqual(route.points.slice(1, -1), relation.via, '\u4f5c\u8005 via \u70b9\u5fc5\u987b\u539f\u6837\u4fdd\u7559');
    if (relation.route === 'straight') assert.equal(route.points.length, 2, '\u4f5c\u8005\u8981\u6c42\u7684\u76f4\u7ebf\u8def\u7531\u4e0d\u80fd\u88ab\u81ea\u52a8\u7ed5\u884c\u66ff\u4ee3');
    if (relation.labelAt) {
      const labelGroup = [...svg.matchAll(/<g\b[^>]*data-edge-id="impl_relation"[^>]*>[\s\S]*?<\/g>/g)]
        .map((match) => match[0]).find((group) => group.includes('<text'));
      assert.ok(labelGroup, '\u4f5c\u8005\u5173\u7cfb\u6807\u7b7e\u5fc5\u987b\u4fdd\u7559');
      const label = attrs(labelGroup.match(/<text\b[^>]*>/)[0]);
      assert.deepEqual([Number(label.x), Number(label.y)], relation.labelAt);
    }
  });
}
