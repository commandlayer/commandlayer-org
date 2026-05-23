#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const publicDir = path.join(repoRoot, 'public');

const ALLOWLIST_PREFIXES = [
  '/api/verify',
  '/api/examples/coinbase-webhook',
  '/api/examples/x402-paid-action',
  '/verify/r'
];

const IGNORE_SCHEMES = ['http://', 'https://', 'mailto:', 'tel:', 'javascript:'];

function walk(dir, filter) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, filter));
    } else if (!filter || filter(full)) {
      results.push(full);
    }
  }
  return results;
}

function normalizeRef(raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value === '#' || value.startsWith('#')) return null;
  const lower = value.toLowerCase();
  if (IGNORE_SCHEMES.some((scheme) => lower.startsWith(scheme))) return null;
  if (!value.startsWith('/')) return null;
  return value.split('#')[0].split('?')[0] || '/';
}

function isAllowlistedRoute(refPath) {
  return ALLOWLIST_PREFIXES.some((prefix) => refPath === prefix || refPath.startsWith(`${prefix}/`) || refPath.startsWith(`${prefix}?`));
}

function resolveCandidates(refPath) {
  if (refPath === '/') return [path.join(publicDir, 'index.html')];

  const local = refPath.startsWith('/') ? refPath.slice(1) : refPath;
  const full = path.join(publicDir, local);
  const ext = path.extname(local);

  if (ext) return [full];

  return [
    `${full}.html`,
    path.join(full, 'index.html')
  ];
}

function existsAny(candidates) {
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function collectRefs(html) {
  const refs = [];

  const attrRegex = /\b(href|src|content)\s*=\s*(["'])(.*?)\2/gi;
  for (const match of html.matchAll(attrRegex)) {
    const attr = match[1].toLowerCase();
    const raw = match[3];
    if (attr === 'content' && !raw.trim().startsWith('/')) continue;
    refs.push({ attr, raw });
  }

  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const block of html.matchAll(styleRegex)) {
    const css = block[1];
    const urlRegex = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
    for (const urlMatch of css.matchAll(urlRegex)) {
      refs.push({ attr: 'style:url', raw: urlMatch[2] });
    }
  }

  return refs;
}

function containsIcon2Png(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const forbidden = `icon${2}.png`;
  return content.includes(forbidden);
}

const htmlFiles = walk(publicDir, (file) => file.endsWith('.html'));
const allRepoFiles = walk(repoRoot, (file) => {
  const rel = path.relative(repoRoot, file);
  return !rel.startsWith('.git' + path.sep) && !rel.startsWith('node_modules' + path.sep);
});

const iconViolations = allRepoFiles.filter((file) => containsIcon2Png(file));
if (iconViolations.length > 0) {
  console.error('Found forbidden reference to forbidden icon filename in:');
  for (const file of iconViolations) {
    console.error(`- ${path.relative(repoRoot, file)}`);
  }
  process.exit(1);
}

const missing = [];

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const refs = collectRefs(html);

  for (const ref of refs) {
    const normalized = normalizeRef(ref.raw);
    if (!normalized) continue;
    if (isAllowlistedRoute(normalized)) continue;

    const candidates = resolveCandidates(normalized);
    if (!existsAny(candidates)) {
      missing.push({
        source: path.relative(repoRoot, htmlFile),
        ref: normalized,
        attr: ref.attr
      });
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing local link/asset targets: ${missing.length}`);
  for (const item of missing) {
    console.error(`- source=${item.source} attr=${item.attr} ref=${item.ref}`);
  }
  process.exit(1);
}

console.log(`All local links/assets resolved across ${htmlFiles.length} HTML files.`);
