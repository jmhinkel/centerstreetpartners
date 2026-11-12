/**
 * One-time migration: lift the articles that were hand-coded inside index.html
 * out into the content library, so they sit alongside anything published from Drive.
 *
 * Run once:  node build/extract-seed.mjs
 *
 * Inline base64 images are written out as real files — that alone takes ~500KB
 * off the homepage, since every article's images currently load with the front page.
 */
import { load } from 'cheerio';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'site', 'index.source.html');
const CONTENT = path.join(ROOT, 'content');

/** Each entry describes where one article lives in the legacy markup. */
const SEEDS = [
  {
    id: 'article-22',
    category: 'Legacy Builders',
    issue: 22,
    date: '2026-04-10',
    slug: 'why-finance-is-just-as-important-as-faith-and-family',
    featured: true,
    bodyParts: ['#article-22 .article-body', '#article-rest'],
  },
  {
    id: 'article-jay',
    category: "Jay's Articles",
    date: '2026-04-09',
    slug: 'meet-jay-hinkel',
    bodyParts: ['#article-jay-rest'],
  },
  {
    id: 'article-21',
    category: 'Legacy Builders',
    issue: 21,
    date: '2026-04-03',
    slug: 'ancient-wisdom-for-honest-money',
    bodyParts: ['#article-21-rest'],
  },
  {
    id: 'article-gold',
    category: 'Gold Report',
    date: '2026-03-18',
    slug: 'wars-and-rumors-of-wars',
    bodyParts: ['#article-gold-rest'],
  },
  { id: 'article-18', category: 'Legacy Builders', issue: 18, slug: 'inflation-is-a-tax', stub: true },
  { id: 'article-17', category: 'Legacy Builders', issue: 17, slug: 'the-stewardship-mindset', stub: true },
  { id: 'article-16', category: 'Legacy Builders', issue: 16, slug: 'why-business-owners-need-a-different-financial-plan', stub: true },
];

const text = (el) => (el.text() || '').replace(/\s+/g, ' ').trim();

/** Pull `data:` images out into files and repoint the src at them. */
async function externaliseImages($, scope, slug, dir) {
  let n = 0;
  const imgs = scope.find('img').toArray();
  for (const el of imgs) {
    const img = $(el);
    const src = img.attr('src') || '';
    const m = /^data:image\/([a-z+]+);base64,(.+)$/i.exec(src);
    if (!m) continue;

    const buf = Buffer.from(m[2], 'base64');
    // Trust the magic bytes, not the declared type — several of these are
    // labelled image/png while actually holding JPEG data.
    const ext = buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
      : buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
      : m[1].replace('+xml', '').replace('jpeg', 'jpg');

    const name = `${slug}-${++n}.${ext}`;
    await writeFile(path.join(dir, name), buf);
    img.attr('src', `/articles/images/${name}`);
    img.attr('loading', 'lazy');
    img.removeAttr('style');
  }
  return n;
}

const run = async () => {
  if (!existsSync(SOURCE)) {
    console.error(`Missing ${path.relative(ROOT, SOURCE)} — copy the current index.html there first.`);
    process.exit(1);
  }

  const $ = load(await readFile(SOURCE, 'utf8'));
  const imageDir = path.join(ROOT, 'site', 'articles', 'images');
  await mkdir(imageDir, { recursive: true });
  // Only clear the articles this script owns. Anything synced from Drive lives
  // in the same folder and must survive a re-run of the migration.
  for (const seed of SEEDS) {
    await rm(path.join(CONTENT, seed.slug), { recursive: true, force: true });
  }
  await mkdir(CONTENT, { recursive: true });

  const manifest = [];

  for (const seed of SEEDS) {
    const card = $(`#${seed.id}`);
    if (!card.length) {
      console.warn(`  ! ${seed.id} not found — skipped`);
      continue;
    }

    const title = text(card.find('h2, h4').first());
    const meta = text(card.find('.section-label, .past-article-meta').first());
    const author = text(card.find('p').filter((_, p) => /^By /i.test($(p).text().trim())).first())
      || (seed.category === 'Gold Report' || seed.category === 'Legacy Builders' ? 'Brad Skiles' : 'Brad Skiles');

    const dir = path.join(CONTENT, seed.slug);
    await mkdir(dir, { recursive: true });

    let body = '';
    let summary = '';
    let images = 0;

    if (seed.stub) {
      summary = text(card.find('p').first());
    } else {
      // The teaser sits above the collapsed remainder — but skip the byline
      // paragraph ("By Brad Skiles, CLU · ChFC…"), which precedes it on the
      // featured article and would otherwise be used as the summary.
      const candidates = [...card.children('p').toArray(), ...card.find('.article-body p').toArray()];
      const teaser = candidates
        .map((p) => text($(p)))
        .find((t) => t.length > 60 && !/^By\s/i.test(t));
      summary = teaser ?? '';

      for (const sel of seed.bodyParts) {
        const part = $(sel);
        if (!part.length) continue;
        images += await externaliseImages($, part, seed.slug, imageDir);
        part.find('#article-preview-fade, [id$="-preview-fade"]').remove();
        body += part.html() ?? '';
      }
      // strip the collapse/expand scaffolding — separate pages don't need it
      const $$ = load(`<div id="w">${body}</div>`, null, false);
      $$('#w').find('button, [id$="-wrap"]').remove();
      body = $$('#w').html() ?? '';
    }

    // the LPL tracking number lives in the trailing disclosure paragraph
    const tracking = /Tracking #(\d+)/.exec(body + ' ' + card.text())?.[1] ?? null;

    const record = {
      slug: seed.slug,
      title,
      category: seed.category,
      issue: seed.issue ?? null,
      date: seed.date ?? null,
      author,
      summary,
      tracking,
      legacyMeta: meta,
      status: seed.stub ? 'stub' : 'published',
      featured: !!seed.featured,
      source: 'seed',
      images,
    };

    await writeFile(path.join(dir, 'article.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    if (body.trim()) await writeFile(path.join(dir, 'body.html'), body.trim() + '\n', 'utf8');

    manifest.push(record);
    console.log(
      `  ${seed.stub ? 'stub' : 'full'}  ${seed.category.padEnd(16)} ${title.slice(0, 52).padEnd(52)} ` +
      `${images} img  ${body.length} chars`
    );
  }

  console.log(`\nExtracted ${manifest.length} articles into content/`);
};

run().catch((err) => { console.error(err); process.exit(1); });
