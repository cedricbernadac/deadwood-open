// Shared loader for public/ browser modules in Node tests. Modules that import
// '/vendor/three.module.js', directly or through a relative import, cannot be
// resolved by Node; they load as data: URLs with three rewritten to the local
// package and every relative import rewritten to the URL of its target. Other
// modules keep their real file: URL, so they share instances with direct
// imports such as import('../public/rules.js').
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THREE_URL = import.meta.resolve('three');
const DEFAULT_ROOT = new URL('../../public/', import.meta.url);
const cache = new Map();
const resolving = new Set();

// Static import/export specifiers, including multi-line statements; dynamic
// import() expressions and plain string literals are left untouched.
const SPECIFIER = /\b(?:import(?!\s*\()|export)\b[^;]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\1/g;

function rootUrl(root) {
  if (!root) return DEFAULT_ROOT;
  const url = root instanceof URL ? root : pathToFileURL(String(root));
  return url.href.endsWith('/') ? url : new URL(url.href + '/');
}

function rewrite(source, base) {
  let browserOnly = false;
  const rewritten = source.replace(SPECIFIER, (statement, q1, s1, q2, s2) => {
    const specifier = s1 ?? s2;
    let target = null;
    if (specifier === '/vendor/three.module.js') {
      browserOnly = true;
      target = THREE_URL;
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      target = resolveModule(new URL(specifier, base));
      if (target.startsWith('data:')) browserOnly = true;
    }
    return target ? statement.slice(0, -(specifier.length + 2)) + JSON.stringify(target) : statement;
  });
  return { rewritten, browserOnly };
}

function resolveModule(fileUrl) {
  const href = fileUrl.href;
  if (cache.has(href)) return cache.get(href);
  if (resolving.has(href)) throw new Error(`Circular import involving ${href}`);
  resolving.add(href);
  let source;
  try {
    source = readFileSync(fileURLToPath(fileUrl), 'utf8');
  } catch {
    resolving.delete(href);
    throw new Error(`Public module ${href} does not exist`);
  }
  const { rewritten, browserOnly } = rewrite(source, fileUrl);
  resolving.delete(href);
  const url = browserOnly ? `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}` : href;
  cache.set(href, url);
  return url;
}

export function publicModuleUrl(name, { root } = {}) {
  return resolveModule(new URL(name, rootUrl(root)));
}

export async function importPublicModule(name, { root } = {}) {
  return import(publicModuleUrl(name, { root }));
}

// Loads source text (for example a Git baseline) as the named module of root.
export async function importPublicSource(source, { name = 'world.js', root } = {}) {
  const { rewritten } = rewrite(source, new URL(name, rootUrl(root)));
  return import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`);
}
