/**
 * Makes dist/ browsable straight off the filesystem, for review without a server.
 *
 * The real site uses absolute URLs ("/assets/x.jpg", "/articles/some-slug"), which
 * only resolve when something is serving the folder. This rewrites them to relative
 * paths with .html extensions so index.html can just be double-clicked.
 *
 *   node build/preview.mjs   ->  preview/
 */
import { readFile, writeFile, readdir, rm, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'preview');

/** Every page that exists as a file, so we know which links need an .html suffix. */
async function pageSlugs() {
  const dir = path.join(DIST, 'articles');
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
}

function rewrite(html, depth, slugs) {
  const up = depth === 0 ? '' : '../'.repeat(depth);

  // page links first — these gain an .html extension as well as a relative prefix
  for (const slug of slugs) {
    html = html.replaceAll(`"/articles/${slug}"`, `"${depth === 1 ? '' : 'articles/'}${slug}.html"`);
  }
  html = html.replaceAll('"/landing-page"', `"${up}landing-page.html"`);

  // homepage anchors: "/#help" -> "index.html#help"
  html = html.replace(/"\/#([a-z0-9-]+)"/gi, `"${up}index.html#$1"`);
  html = html.replaceAll('href="/"', `href="${up}index.html"`);

  // everything else that is root-relative is an asset
  html = html.replace(/(href|src)="\/([^"]+)"/g, (m, attr, rest) =>
    rest.startsWith('.netlify') ? m : `${attr}="${up}${rest}"`);

  return html;
}

const run = async () => {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build:local` first.');
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  await cp(DIST, OUT, { recursive: true });

  const slugs = await pageSlugs();
  let count = 0;

  const walk = async (dir, depth) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name.endsWith('.html')) {
        await writeFile(full, rewrite(await readFile(full, 'utf8'), depth, slugs), 'utf8');
        count += 1;
      }
    }
  };
  await walk(OUT, 0);

  console.log(`Rewrote ${count} page(s) for offline viewing -> preview/`);
  console.log('Open preview/index.html in a browser.');
};

run().catch((err) => { console.error(err); process.exit(1); });
