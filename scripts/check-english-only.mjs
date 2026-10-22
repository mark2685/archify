#!/usr/bin/env node
// The Hadrian fork is English-only. This scan fails when any tracked text file
// contains a character from a non-Latin script, unless the file is listed in
// scripts/english-only-allowlist.json with a reason. Escaped forms such as
// \u4e2d in test inputs are plain ASCII and pass; they are how the fork keeps
// wide-glyph regressions without carrying the glyphs themselves (FORK.md).
//
// Usage: node scripts/check-english-only.mjs [--root <dir>] [--list]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? scriptRoot : path.resolve(args[rootFlag + 1] || '');
const list = args.includes('--list');

// Scripts the fork does not write in. Latin, Greek-as-symbols (Ω, μ) and
// general punctuation are allowed; everything below is a script boundary.
export const NON_ENGLISH = new RegExp([
  '\\u0400-\\u04FF', // Cyrillic
  '\\u0530-\\u058F', // Armenian
  '\\u0590-\\u05FF', // Hebrew
  '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF', // Arabic
  '\\u0900-\\u0DFF', // Indic scripts
  '\\u0E00-\\u0E7F', // Thai
  '\\u1100-\\u11FF\\u3130-\\u318F\\uA960-\\uA97F\\uAC00-\\uD7FF', // Hangul
  '\\u2E80-\\u2FDF\\u3000-\\u303F\\u3040-\\u30FF\\u3100-\\u312F\\u31A0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFFEF', // Han, kana, CJK punctuation and fullwidth forms
].join(''), 'u');
const NON_ENGLISH_CLASS = new RegExp(`[${NON_ENGLISH.source}]`, 'u');
// Supplementary-plane CJK (U+20000 and above) arrives as surrogate pairs.
const SUPPLEMENTARY_CJK = /[\uD840-\uD87F][\uDC00-\uDFFF]/;

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|zip|gz|tgz|woff2?|ttf|otf|eot|mp4|webm|pdf|lock)$/i;

export function scan(repoRoot) {
  const allowlistPath = path.join(repoRoot, 'scripts', 'english-only-allowlist.json');
  const allowlist = fs.existsSync(allowlistPath)
    ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    : { entries: [] };
  const allowed = new Map(allowlist.entries.map((entry) => [entry.path, entry.reason]));
  for (const [file, reason] of allowed) {
    if (typeof reason !== 'string' || reason.trim().length < 12) throw new Error(`english-only allowlist entry ${file} needs a reason`);
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const violations = [];
  const usedAllowances = new Set();
  for (const file of tracked) {
    if (BINARY.test(file)) continue;
    const absolute = path.join(repoRoot, file);
    let text;
    try {
      text = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    const lines = text.split('\n');
    const hits = [];
    lines.forEach((line, index) => {
      const match = line.match(NON_ENGLISH_CLASS) || line.match(SUPPLEMENTARY_CJK);
      if (match) hits.push({ line: index + 1, column: match.index + 1, sample: line.trim().slice(0, 80) });
    });
    if (hits.length === 0) continue;
    if (allowed.has(file)) {
      usedAllowances.add(file);
      continue;
    }
    violations.push({ file, hits });
  }
  const stale = [...allowed.keys()].filter((file) => !usedAllowances.has(file));
  return { violations, stale, allowed: [...allowed.keys()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { violations, stale } = scan(root);
  if (list) {
    for (const { file, hits } of violations) console.log(`${file}: ${hits.length} line(s)`);
  }
  let failed = false;
  for (const { file, hits } of violations) {
    failed = true;
    for (const hit of hits.slice(0, 3)) console.error(`english-only: ${file}:${hit.line}:${hit.column}: ${hit.sample}`);
    if (hits.length > 3) console.error(`english-only: ${file}: ${hits.length - 3} more line(s)`);
  }
  for (const file of stale) {
    failed = true;
    console.error(`english-only: allowlist entry ${file} no longer has non-English text; remove it from scripts/english-only-allowlist.json`);
  }
  if (failed) {
    console.error('english-only: non-English text found. Translate it, escape test input as \\uXXXX, or add the file to scripts/english-only-allowlist.json with a reason.');
    process.exit(1);
  }
  console.log('english-only ok');
}
