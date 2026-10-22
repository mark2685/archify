import test from 'node:test';
import assert from 'node:assert/strict';
import {lintExplainerWriting} from '../archify/explainer/writing.mjs';
const entry = (text, extra = {}) => ({text, line: 1, component: 'prose', ...extra});

test('writing: independently authored hints give concrete repairs without failing by default', () => {
  const result = lintExplainerWriting([
    entry('Perform an analysis of the cache. At the end of the day, many users need each and every result.'),
  ]);
  assert.deepEqual(new Set(result.map(d => d.evidence.rule)), new Set(['light-verb', 'cliche', 'vague-quantity', 'redundancy']));
  assert.ok(result.every(d => d.severity === 'warning' && d.code.startsWith('explainer/writing-')));
  assert.ok(result.every(d => d.evidence.reason && d.evidence.example && d.supportedFixes.length));
  assert.ok(result.some(d => d.evidence.matched === 'Perform an analysis of'));
  assert.ok(result.some(d => d.evidence.matched === 'many users'));
});

test('writing: direct technical prose and quoted URL bodies do not trigger phrase hints', () => {
  assert.deepEqual(lintExplainerWriting([
    entry('The API checks the cache. Measured at 3.5 ms over a sample of 120 requests.'),
    entry('Analyze the cache. The limit is 32 requests per second. Read https://example.test/many-users/future-plans.'),
    entry('The current plan and the future plan cover two separate periods. Make a request to the API.'),
  ]), []);
});

test('writing: long sentences count words, not punctuation or decimal dots', () => {
  const result = lintExplainerWriting([
    entry('After the cache read returns empty, the API waits for the database and then writes the value back into the cache.', {line: 4}),
    entry('Latency is 3.5 ms and the database returns the result before the cache is updated.'),
  ], {sentenceLimits: {en: 8}});
  assert.equal(result.length, 2);
  assert.ok(result.every(d => d.code === 'explainer/writing-sentence-length'));
  assert.equal(result[0].subject.line, 4);
  assert.equal(result[1].evidence.units, 15);
  assert.deepEqual(lintExplainerWriting([entry('The cache read returns empty. The API waits for the database. Then it writes back.')], {sentenceLimits: {en: 8}}), []);
});

test('writing: reading units count characters for scripts written without spaces', () => {
  // The unit counter is general Unicode handling: an authored sentence in a
  // character-counted script is measured by characters, so the limit still
  // applies. The sample is escaped to keep the repository English-only.
  const characterCounted = '\u7f13\u5b58\u8bfb\u53d6\u8fd4\u56de\u7a7a\u503c\u540e\u63a5\u53e3\u7b49\u5f85\u6570\u636e\u5e93';
  const result = lintExplainerWriting([entry(`${characterCounted}\u3002`)], {sentenceLimits: {zh: 12}});
  assert.equal(result.length, 1);
  assert.equal(result[0].evidence.units, 16);
});

test('writing: strict and off mode preserve explicit severity control', () => {
  assert.ok(lintExplainerWriting([entry('Many users.')], {mode: 'strict'}).every(d => d.severity === 'error'));
  assert.deepEqual(lintExplainerWriting([entry('Many users.')], {mode: 'off'}), []);
  assert.throws(() => lintExplainerWriting([], {mode: 'silent'}), /mode/);
  assert.throws(() => lintExplainerWriting([], {sentenceLimits: {en: 0}}), /positive integers/);
});

test('writing: source line offsets, component targets and diagnostic order survive repeated calls', () => {
  const entries = [entry('The API reads the cache.\n\nConduct a review of it.\nMany users.', {line: 20, component: 'answer', panelId: 'recommendation'})];
  const first = lintExplainerWriting(entries);
  assert.deepEqual(first.map(d => d.subject.line), [22, 23]);
  assert.ok(first.every(d => d.subject.component === 'answer' && d.subject.panelId === 'recommendation'));
  assert.deepEqual(lintExplainerWriting(entries), first);
  assert.equal(entries[0].text, 'The API reads the cache.\n\nConduct a review of it.\nMany users.');
});

test('writing: a URL with sentence punctuation is excluded from length but leaves the next sentence measurable', () => {
  const entries = [entry('Read https://example.test/a.b?q=3.5. Then read the measured result before changing the cache behavior.')];
  const result = lintExplainerWriting(entries, {sentenceLimits: {en: 5}, locale: 'en-US'});
  assert.equal(result.length, 1);
  assert.equal(result[0].evidence.units, 10);
});

test('writing: URL masking preserves prose after bare and Markdown links', () => {
  for (const text of [
    '[Source](https://example.com). Many users conduct a review of it.',
    '[Source](https://example.com) Many users conduct a review of it.',
    '[Source](https://example.com).Many users conduct a review of it.',
    'https://example.com. Many users conduct a review of it.',
    'https://example.com, many users conduct a review of it.',
    'https://example.com! Many users conduct a review of it.',
    '[Source](https://example.com/topic_(one)).\nMany users conduct a review of it.',
  ]) {
    const result = lintExplainerWriting([entry(text, {line: 10})], {mode: 'strict'});
    assert.deepEqual(new Set(result.map(d => d.evidence.rule)), new Set(['vague-quantity', 'light-verb']), text);
    assert.ok(result.every(d => d.severity === 'error'));
    assert.ok(result.every(d => d.subject.line === (text.includes('\n') ? 11 : 10)));
  }
});

test('writing: URL paths and balanced URL parentheses stay masked', () => {
  assert.deepEqual(lintExplainerWriting([
    entry('[Source](https://example.com/future%20plans/many-users/topic_(choose-a-path)). Check the cache.'),
    entry('Read https://example.com/(future-plans)/many-users?q=3.5. Check the cache.'),
    entry('[Notes](https://example.com/%E8%B5%84%E6%96%99). Check the cache.'),
  ], {mode: 'strict'}), []);
});

test('writing: long paragraphs, an all-bold conclusion and a disclaimer-style scope get structural hints', () => {
  const rules = entries => lintExplainerWriting(entries).map(item => item.evidence.rule);
  assert.deepEqual(rules([entry('One. Two. Three. Four. Five.')]), ['paragraph-length']);
  assert.deepEqual(rules([entry('One. Two. Three.', {component: 'list'})]), []);
  const summary = 'Keep a modular monolith first and split services only after the module boundaries settle.';
  assert.deepEqual(rules([entry(summary, {component: 'answer', pointer: '/answer/summary', raw: `**${summary}**`})]), ['verdict-emphasis']);
  assert.deepEqual(rules([entry(summary, {component: 'answer', pointer: '/answer/summary', raw: 'Keep a **modular monolith** first and split services only after the module boundaries settle.'})]), []);
  assert.deepEqual(rules([entry('This page discusses a direction that is not implemented yet. It relies on the user\'s statements and did not check the history. The page is only a reading sample, it is not a legal review, it has not been verified by running anything in production at all, and nothing here should be read as a commitment.', {component: 'scope'})]), ['scope-length']);
  assert.deepEqual(rules([entry('Illustrative · 8-person team', {component: 'scope'})]), []);
});

test('writing: controlled-language hints stay precise', () => {
  const rules = text => lintExplainerWriting([entry(text)]).map(item => item.evidence.rule);
  assert.deepEqual(rules('In summary, make a decision first and then conduct a review of it.'), ['filler', 'light-verb', 'light-verb']);
  assert.deepEqual(rules('In order to utilize the cache, read it first.'), ['plain-word', 'plain-word']);
  assert.deepEqual(rules('In summary, this cutting-edge design is seamless.'), ['filler', 'cliche', 'cliche']);
  assert.deepEqual(rules('This is illustrative only.'), ['qualification']);
  assert.deepEqual(lintExplainerWriting(['The task is in progress.', 'Retry more than 3 times.', 'Use the cache before the database.'].map(text => entry(text))), []);
});
