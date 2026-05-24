#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const publicDir = path.join(repoRoot, 'public');

const DYNAMIC_ROUTE_ALLOWLIST = new Set([
  '/verify/r',
  '/api/verify',
  '/api/agents/verifyagent',
  '/api/examples/coinbase-webhook',
  '/api/examples/x402-paid-action',
  '/api/auth/nonce',
  '/api/auth/verify',
  '/api/ens/owned'
]);

const IGNORE_SCHEMES = ['http://', 'https://', 'mailto:', 'tel:', 'javascript:'];
const FORBIDDEN_TOKEN = ['icon', '2', '.png'].join('');

function walk(dir, shouldIncludeFile) {
  const output = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      output.push(...walk(fullPath, shouldIncludeFile));
      continue;
    }

    if (!shouldIncludeFile || shouldIncludeFile(fullPath)) {
      output.push(fullPath);
    }
  }

  return output;
}

function normalizeLocalRef(raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value === '#' || value.startsWith('#')) return null;

  const lower = value.toLowerCase();
  if (IGNORE_SCHEMES.some((prefix) => lower.startsWith(prefix))) return null;
  if (!value.startsWith('/')) return null;

  const noHash = value.split('#')[0];
  const noQuery = noHash.split('?')[0];
  return noQuery || '/';
}

function resolvePublicCandidates(localPath) {
  if (localPath === '/') {
    return [path.join(publicDir, 'index.html')];
  }

  const relativePath = localPath.slice(1);
  const base = path.join(publicDir, relativePath);

  if (path.extname(relativePath)) {
    return [base];
  }

  return [
    `${base}.html`,
    path.join(base, 'index.html')
  ];
}

function collectHtmlRefs(html) {
  const refs = [];

  const attrRegex = /\b(href|src|content)\s*=\s*(["'])(.*?)\2/gi;
  for (const match of html.matchAll(attrRegex)) {
    const attr = match[1].toLowerCase();
    const raw = match[3];

    if (attr === 'content' && !raw.trim().startsWith('/')) {
      continue;
    }

    refs.push({ attr, raw });
  }

  const styleBlockRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const styleBlock of html.matchAll(styleBlockRegex)) {
    const css = styleBlock[1];
    const cssUrlRegex = /url\(\s*(["']?)(.*?)\1\s*\)/gi;

    for (const urlMatch of css.matchAll(cssUrlRegex)) {
      refs.push({ attr: 'style:url', raw: urlMatch[2] });
    }
  }

  return refs;
}

const htmlFiles = walk(publicDir, (filePath) => filePath.endsWith('.html'));
const missingRefs = [];

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const refs = collectHtmlRefs(html);

  for (const ref of refs) {
    const normalized = normalizeLocalRef(ref.raw);
    if (!normalized) continue;
    if ([...DYNAMIC_ROUTE_ALLOWLIST].some((route) => normalized === route || normalized.startsWith(`${route}/`))) continue;

    const candidates = resolvePublicCandidates(normalized);
    const exists = candidates.some((candidate) => fs.existsSync(candidate));

    if (!exists) {
      missingRefs.push({
        source: path.relative(repoRoot, htmlFile),
        path: normalized,
        attr: ref.attr
      });
    }
  }
}

const repoFiles = walk(repoRoot);
const forbiddenFiles = [];

for (const filePath of repoFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(FORBIDDEN_TOKEN)) {
    forbiddenFiles.push(path.relative(repoRoot, filePath));
  }
}

if (forbiddenFiles.length > 0) {
  console.error(`Forbidden token \"${FORBIDDEN_TOKEN}\" found in:`);
  for (const file of forbiddenFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

if (missingRefs.length > 0) {
  console.error(`Missing local link/asset targets: ${missingRefs.length}`);
  for (const entry of missingRefs) {
    console.error(`- source=${entry.source} attr=${entry.attr} ref=${entry.path}`);
  }
  process.exit(1);
}

console.log(`All local links/assets resolved across ${htmlFiles.length} HTML files.`);
