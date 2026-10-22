import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSvgPath } from '../archify/renderers/shared/svg-path-analysis.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const epsilon = 0.0001;
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));

function fixture({ horizontal = false, conflict, dashed = false, offset = 0, width } = {}) {
  const table = (id, pos, rows = 3) => ({
    id, label: id, pos, width: rows * 20 + 36,
    attributes: Array.from({ length: rows }, (_, index) => ({ name: `f${index}`, type: 'int' })),
  });
  const document = {
    schema_version: 1, diagram_type: 'erd',
    meta: { title: 'Independent relationship beside a shared parent', locale: 'en', quality_profile: 'showcase', legend: { mode: 'hidden' } },
    entities: [table('hub', [40, 80], 4), table('a', [240, 0]), table('b', [240, 280]), table('c', [440, 0]), table('d', [440, 280])],
    relationships: [
      { id: 'a_hub', from: 'a', to: 'hub', fromCardinality: 'many', toCardinality: 'one', fromSide: 'left', toSide: 'right' },
      { id: 'b_hub', from: 'b', to: 'hub', fromCardinality: 'many', toCardinality: 'one', fromSide: 'left', toSide: 'right' },
    ],
  };
  if (conflict) {
    // Leave a 24px gap between the two logical trunks; an independent relationship's explicit U-shaped route enters that gap.
    // Tangency uses a 16px return segment so the rounded corner touches the bus exactly; overlap uses 20px to leave real straight ink.
    const x = conflict === 'crossing' ? 164 : 172 + offset;
    const [top, bottom] = width > 1.5 || conflict === 'touch' ? [130, 146] : [128, 148];
    document.relationships.push({
      id: 'c_d', from: 'c', to: 'd', fromCardinality: 'many', toCardinality: 'one',
      fromSide: 'left', toSide: 'left',
      via: [[400, 48], [400, top], [x, top], [x, bottom], [400, bottom], [400, 328]],
      ...(dashed ? { identifying: false } : {}),
      ...(width === undefined ? {} : { width }),
    });
  }
  if (horizontal) {
    // Transposing a square entity keeps its size; explicit ports and waypoints are transposed with it.
    document.entities.forEach(entity => { entity.pos.reverse(); });
    document.relationships.forEach(relationship => {
      const sides = { left: 'top', right: 'bottom' };
      relationship.fromSide = sides[relationship.fromSide];
      relationship.toSide = sides[relationship.toSide];
      relationship.via?.forEach(point => point.reverse());
    });
  }
  return document;
}

function render(t, document) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-bridge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.erd.json');
  const output = path.join(directory, 'output.html');
  const source = JSON.stringify(document);
  fs.writeFileSync(input, source);
  const result = spawnSync(process.execPath, [cli, 'render', 'erd', input, output], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(input, 'utf8'), source, '\u4f5c\u8005\u8f93\u5165\u5fc5\u987b\u4fdd\u6301\u539f\u6837');
  const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0];
  const boxes = new Map([...svg.matchAll(/<g\b[^>]*data-node-id="([^"]+)"[^>]*>[\s\S]*?<rect\b([^>]*)>/g)]
    .map(match => [match[1], attributes(match[2])]));
  for (const entity of document.entities) {
    const box = boxes.get(entity.id);
    assert.deepEqual([Number(box.x), Number(box.y), Number(box.width)], [...entity.pos, entity.width], '\u663e\u5f0f\u5b9e\u4f53\u5750\u6807\u548c\u5bbd\u5ea6\u4fdd\u6301\u4e0d\u53d8');
  }
  const paths = [...svg.matchAll(/<path\b[^>]*data-composition-points="[^"]+"[^>]*>/g)].map(match => {
    const attrs = attributes(match[0]);
    const parsed = analyzeSvgPath(attrs.d);
    assert.equal(parsed.ok, true, attrs.d);
    return { attrs, points: attrs['data-composition-points'].split(';').map(pair => pair.split(',').map(Number)),
      segments: parsed.subpaths.flatMap(subpath => subpath.segments) };
  });
  const trunks = paths.filter(route => Object.hasOwn(route.attrs, 'data-er-trunk'));
  const relationships = paths.filter(route => route.attrs['data-edge-id']);
  assert.ok(trunks.length, '\u5b89\u5168\u7684\u4e3b\u5e72\u6bb5\u4ecd\u7136\u7ed8\u5236');
  assert.equal(relationships.length, document.relationships.length, '\u6240\u6709\u5173\u7cfb\u53ca\u5176\u57fa\u6570\u5747\u987b\u4fdd\u7559');
  for (const authored of document.relationships) {
    const route = relationships.find(candidate => candidate.attrs['data-edge-id'] === authored.id);
    assert.deepEqual([route.attrs['data-edge-from'], route.attrs['data-edge-to']], [authored.from, authored.to]);
    assert.equal(route.attrs['marker-start'], `url(#er-${authored.fromCardinality}-start)`);
    assert.equal(route.attrs['marker-end'], `url(#er-${authored.toCardinality}-end)`);
    assert.equal(route.attrs.class, authored.identifying === false ? 'a-dashed' : 'a-default');
    if (authored.via) assert.deepEqual(route.points.slice(1, -1), authored.via, '\u663e\u5f0f\u9014\u7ecf\u70b9\u4e0d\u80fd\u4e3a\u4e86\u603b\u7ebf\u800c\u79fb\u52a8');
  }
  return { trunks, relationships };
}

// The bus is an axis-aligned line; crossings, endpoint contact and positive-length overlap are judged from the straight and curved samples of the actual d.
// Do not read the logical data-composition-points instead of the real ink, or the extra bridge segment added here would be missed.
function hitsTrunk({ start: a, end: b }, { start, end }) {
  const axis = Math.abs(a[0] - b[0]) < epsilon ? 0 : 1;
  const low = Math.min(a[1 - axis], b[1 - axis]);
  const high = Math.max(a[1 - axis], b[1 - axis]);
  if (Math.abs(start[axis] - end[axis]) < epsilon) {
    return Math.abs(start[axis] - a[axis]) < epsilon
      && Math.min(start[1 - axis], end[1 - axis]) <= high + epsilon
      && Math.max(start[1 - axis], end[1 - axis]) >= low - epsilon;
  }
  const amount = (a[axis] - start[axis]) / (end[axis] - start[axis]);
  const position = start[1 - axis] + amount * (end[1 - axis] - start[1 - axis]);
  return amount >= -epsilon && amount <= 1 + epsilon && position >= low - epsilon && position <= high + epsilon;
}

for (const scenario of [
  { conflict: 'crossing', dashed: true },
  { conflict: 'touch' },
  { conflict: 'overlap', horizontal: true },
]) {
  test(`ERD ${scenario.horizontal ? 'horizontal' : 'vertical'} trunk bridges avoid an independent ${scenario.conflict}`, t => {
    const { trunks, relationships } = render(t, fixture(scenario));
    const independent = relationships.find(route => route.attrs['data-edge-id'] === 'c_d');
    for (const trunk of trunks) {
      assert.ok(trunk.segments.every(bus => independent.segments.every(segment => !hitsTrunk(bus, segment))),
        '\u989d\u5916\u6865\u63a5\u4e0d\u80fd\u628a\u65e0\u5173\u5173\u7cfb\u753b\u6210\u603b\u7ebf\u7684\u5206\u652f');
    }
  });
}

test('ERD clear vertical and horizontal fan-in gaps retain one continuous shared trunk', t => {
  for (const horizontal of [false, true]) {
    const { trunks, relationships } = render(t, fixture({ horizontal }));
    const ports = relationships.map(route => route.points.at(-1));
    const along = horizontal ? 0 : 1;
    assert.ok(trunks.some(trunk => {
      const values = trunk.points.map(point => point[along]);
      return Math.min(...values) <= Math.min(...ports.map(point => point[along]))
        && Math.max(...values) >= Math.max(...ports.map(point => point[along]));
    }), '\u540c\u4e00\u603b\u7ebf\u7684\u5408\u6cd5\u5206\u652f\u95f4\u9699\u4ecd\u987b\u8fde\u901a');
  }
});

function pointDistance(point, { start, end }) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
}

function centerlineDistance(trunk, route) {
  if (hitsTrunk(trunk, route)) return 0;
  return Math.min(pointDistance(trunk.start, route), pointDistance(trunk.end, route),
    pointDistance(route.start, trunk), pointDistance(route.end, trunk));
}

for (const horizontal of [false, true]) {
  test(`ERD ${horizontal ? 'horizontal' : 'vertical'} bridge clearance covers both rendered stroke widths`, t => {
    for (const [offset, width] of [[0.1, undefined], [1.2, undefined], [1.5, undefined], [2.5, 4]]) {
      const { trunks, relationships } = render(t, fixture({ conflict: 'near', horizontal, offset, width }));
      const independent = relationships.find(route => route.attrs['data-edge-id'] === 'c_d');
      for (const trunk of trunks) {
        const separation = (Number(trunk.attrs['stroke-width']) + Number(independent.attrs['stroke-width'])) / 2;
        assert.ok(trunk.segments.every(bus => independent.segments.every(segment =>
          centerlineDistance(bus, segment) > separation + epsilon)),
        `\u8ddd\u79bb ${offset} \u7684\u5b9e\u9645\u63cf\u8fb9\u4e0d\u80fd\u88ab\u6865\u63a5\u8fde\u5728\u4e00\u8d77\uff0c\u5305\u542b\u663e\u5f0f\u52a0\u7c97\u5173\u7cfb`);
      }
    }
  });

  test(`ERD ${horizontal ? 'horizontal' : 'vertical'} bridges survive when nearby strokes remain separate`, t => {
    for (const [offset, width] of [[1.6, undefined], [2.85, 4]]) {
      const { trunks, relationships } = render(t, fixture({ conflict: 'near', horizontal, offset, width }));
      const ports = relationships.filter(route => route.attrs['data-edge-id'] !== 'c_d').map(route => route.points.at(-1));
      const along = horizontal ? 0 : 1;
      assert.ok(trunks.some(trunk => {
        const values = trunk.points.map(point => point[along]);
        return Math.min(...values) <= Math.min(...ports.map(point => point[along]))
          && Math.max(...values) >= Math.max(...ports.map(point => point[along]));
      }), '\u6709\u8db3\u591f\u63cf\u8fb9\u95f4\u8ddd\u65f6\u4ecd\u4fdd\u7559\u8fde\u901a\u4e3b\u5e72\uff0c\u4e0d\u80fd\u7528\u8fc7\u5927\u7684\u56fa\u5b9a\u95f4\u8ddd\u4e00\u5f8b\u5220\u9664\u6865\u63a5');
    }
  });
}
