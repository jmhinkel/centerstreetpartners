/**
 * content/  ->  dist/
 *
 * Generates the homepage Articles section and one page per article. Article
 * pages reuse the stylesheet, nav and footer lifted straight out of the
 * homepage source, so there is exactly one place where the site's look lives.
 */
import { load } from 'cheerio';
import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const CATEGORY_ORDER = ['Legacy Builders', 'Gold Report', "Jay's Articles"];

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const prettyDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

const metaLine = (a) =>
  [a.category, prettyDate(a.date), a.issue ? `#${a.issue}` : null].filter(Boolean).join(' · ');

export async function loadArticles(contentDir) {
  if (!existsSync(contentDir)) return [];
  const dirs = (await readdir(contentDir, { withFileTypes: true })).filter((d) => d.isDirectory());

  const articles = [];
  for (const d of dirs) {
    const metaPath = path.join(contentDir, d.name, 'article.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const bodyPath = path.join(contentDir, d.name, 'body.html');
    meta.body = existsSync(bodyPath) ? await readFile(bodyPath, 'utf8') : '';
    articles.push(meta);
  }

  // newest first; undated entries (the old stubs) sink to the bottom
  articles.sort((a, b) => {
    if (!a.date && !b.date) return (b.issue ?? 0) - (a.issue ?? 0);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
  return articles;
}

function articlesSection(articles) {
  const readable = articles.filter((a) => a.status !== 'stub' && a.body.trim());
  const stubs = articles.filter((a) => a.status === 'stub' || !a.body.trim());
  const featured = readable.find((a) => a.featured) ?? readable[0];
  const rest = readable.filter((a) => a !== featured);

  const present = CATEGORY_ORDER.filter((c) => readable.some((a) => a.category === c));
  const extra = [...new Set(readable.map((a) => a.category))].filter((c) => !CATEGORY_ORDER.includes(c));
  const categories = [...present, ...extra];

  const filters = categories.length > 1
    ? `
      <div class="article-filters" role="group" aria-label="Filter articles by category">
        <button type="button" class="article-filter is-active" data-filter="all">All<span class="af-count">${readable.length}</span></button>
${categories.map((c) => `        <button type="button" class="article-filter" data-filter="${esc(c)}">${esc(c)}<span class="af-count">${readable.filter((a) => a.category === c).length}</span></button>`).join('\n')}
      </div>`
    : '';

  const featuredCard = featured
    ? `
      <a class="article-feature" href="/articles/${esc(featured.slug)}" data-category="${esc(featured.category)}">
        <span class="af-flag">Latest</span>
        <div class="section-label">${esc(metaLine(featured))}</div>
        <h3>${esc(featured.title)}</h3>
        <p>${esc(featured.summary)}</p>
        <span class="af-go">Read the article &rarr;</span>
      </a>`
    : '';

  const rows = rest.map((a) => `
        <a class="article-row" href="/articles/${esc(a.slug)}" data-category="${esc(a.category)}">
          <span class="ar-meta">${esc(metaLine(a))}</span>
          <span class="ar-body">
            <span class="ar-title">${esc(a.title)}</span>
            <span class="ar-summary">${esc(a.summary)}</span>
          </span>
        </a>`).join('');

  const stubBlock = stubs.length
    ? `
      <div class="article-stubs">
        <div class="section-label">Back issues available on request</div>
        <ul>
${stubs.map((a) => `          <li><span>${esc(metaLine(a) || a.category + (a.issue ? ` · #${a.issue}` : ''))}</span> ${esc(a.title)}</li>`).join('\n')}
        </ul>
        <p><a href="#contact">Get in touch</a> and we'll send you any of these.</p>
      </div>`
    : '';

  // Eyebrow and standfirst are new copy; the "Articles" heading itself is not.
  const intro = includePendingCopy()
    ? `    <div class="section-label">Insights &amp; Commentary</div>
    <h2 class="section-title">Articles</h2>
    <div class="divider"></div>
    <p class="articles-intro">Writing on monetary history, wealth preservation, and stewardship from Brad Skiles and Jay Hinkel.</p>`
    : `    <h2 class="section-title">Articles</h2>
    <div class="divider"></div>`;

  return `
  <div class="container">
${intro}
${featuredCard}
${filters}
      <div class="article-list">${rows}
      </div>
      <p class="article-empty" hidden>No articles in this category yet.</p>
${stubBlock}
  </div>`;
}

const ARTICLES_CSS = `
  /* ── ARTICLES: listing ── */
  .articles-intro { max-width: 620px; color: var(--muted); font-size: 0.95rem; line-height: 1.85; }
  .article-feature {
    display: block; position: relative; margin-top: 2.5rem; padding: 2rem 2.25rem;
    background: var(--cream); border: 1px solid var(--border); border-left: 3px solid var(--gold);
    text-decoration: none; color: inherit; transition: transform 0.25s, box-shadow 0.25s;
  }
  .article-feature:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(28,22,18,0.10); }
  .article-feature .af-flag {
    position: absolute; top: 0; right: 0; background: var(--gold); color: #fff;
    font-size: 0.6rem; letter-spacing: 0.2em; text-transform: uppercase; padding: 0.3rem 0.8rem;
  }
  .article-feature h3 {
    font-family: var(--font-display); font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 600;
    color: var(--deep); line-height: 1.25; margin-bottom: 0.75rem;
  }
  .article-feature p { font-size: 0.92rem; line-height: 1.8; color: var(--muted); margin-bottom: 1.25rem; }
  .af-go { font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold); font-weight: 500; }

  .article-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 2.5rem 0 0.5rem; }
  .article-filter {
    display: inline-flex; align-items: center; gap: 0.5rem;
    background: transparent; border: 1px solid var(--border); color: var(--muted);
    font-family: var(--font-body); font-size: 0.7rem; font-weight: 500;
    letter-spacing: 0.14em; text-transform: uppercase; padding: 0.55rem 1rem;
    cursor: pointer; transition: all 0.2s;
  }
  .article-filter:hover { border-color: var(--gold); color: var(--gold); }
  .article-filter.is-active { background: var(--deep); border-color: var(--deep); color: #fff; }
  .af-count { font-size: 0.62rem; opacity: 0.6; }

  .article-list { margin-top: 1.5rem; border-top: 1px solid var(--border); }
  .article-row {
    display: flex; flex-wrap: wrap; gap: 0.35rem 1.5rem; align-items: baseline;
    padding: 1.15rem 0.25rem; border-bottom: 1px solid rgba(155,28,28,0.10);
    text-decoration: none; color: var(--text); transition: padding-left 0.2s, color 0.2s;
  }
  .article-row:hover { color: var(--gold); padding-left: 0.6rem; }
  .ar-meta { flex: 0 0 13rem; font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .ar-body { flex: 1 1 20rem; }
  .ar-title { display: block; font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; line-height: 1.3; }
  .ar-summary { display: block; font-size: 0.85rem; line-height: 1.7; color: var(--muted); margin-top: 0.25rem; }
  .article-empty { margin-top: 1.5rem; font-size: 0.9rem; color: var(--muted); font-style: italic; }

  .article-stubs { margin-top: 3rem; padding-top: 1.75rem; border-top: 1px solid var(--border); }
  .article-stubs ul { list-style: none; margin-top: 0.5rem; }
  .article-stubs li { font-size: 0.88rem; color: var(--text); padding: 0.4rem 0; }
  .article-stubs li span { display: inline-block; min-width: 11rem; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .article-stubs p { margin-top: 1rem; font-size: 0.85rem; color: var(--muted); }
  .article-stubs a { color: var(--gold); }

  @media (max-width: 700px) {
    .ar-meta { flex-basis: 100%; }
    .article-stubs li span { display: block; min-width: 0; }
  }

  /* ── ARTICLES: single page ── */
  .article-page { padding-top: 8rem; }
  .article-page .container { max-width: 720px; }
  .article-back { display: inline-block; font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); text-decoration: none; margin-bottom: 1.5rem; }
  .article-back:hover { color: var(--gold); }
  .article-page h1 { font-family: var(--font-display); font-size: clamp(1.9rem, 4.5vw, 2.9rem); font-weight: 600; color: var(--deep); line-height: 1.18; margin-bottom: 0.75rem; }
  .article-byline { font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 500; margin-bottom: 2.5rem; }
  .article-content p { font-size: 0.95rem; line-height: 1.9; color: var(--text); margin-bottom: 1.15rem; }
  .article-content h3 { font-family: var(--font-display); font-size: 1.45rem; color: var(--deep); margin: 2.25rem 0 0.85rem; }
  .article-content h4 { font-family: var(--font-display); font-size: 1.15rem; color: var(--deep); margin: 1.75rem 0 0.6rem; }
  .article-content ul, .article-content ol { margin: 0 0 1.15rem 1.5rem; }
  .article-content li { font-size: 0.95rem; line-height: 1.9; color: var(--text); padding: 0.15rem 0; }
  .article-content blockquote {
    border-left: 3px solid var(--gold); background: var(--cream);
    padding: 1.1rem 1.5rem; margin: 1.75rem 0; font-style: italic; color: var(--text); font-size: 0.95rem; line-height: 1.85;
  }
  .article-content img { max-width: 100%; height: auto; margin: 1.75rem auto; display: block; box-shadow: 0 4px 16px rgba(28,22,18,0.12); }
  .article-content .article-closing { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 1.25rem 0; margin: 2rem 0; }
  .article-content .article-closing p { margin: 0; font-family: var(--font-display); font-size: 1.15rem; color: var(--deep); }
  .article-disclosure { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border); font-size: 0.72rem; line-height: 1.7; color: var(--muted); }
  .article-review-flag { background: #fff4e5; border-left: 3px solid #d68910; padding: 0.9rem 1.2rem; margin-bottom: 2rem; font-size: 0.82rem; color: #7a5b12; }
  .article-next { margin-top: 3rem; padding-top: 1.75rem; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 1rem 2rem; justify-content: space-between; }
  .article-next a { font-size: 0.8rem; color: var(--gold); text-decoration: none; }
  .article-next a:hover { text-decoration: underline; }
`;

const FILTER_JS = `
<script>
  (function () {
    const buttons = document.querySelectorAll('.article-filter');
    const rows = document.querySelectorAll('.article-row, .article-feature');
    const empty = document.querySelector('.article-empty');
    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const want = btn.dataset.filter;
        buttons.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        let shown = 0;
        rows.forEach(function (row) {
          const match = want === 'all' || row.dataset.category === want;
          row.hidden = !match;
          if (match) shown++;
        });
        if (empty) empty.hidden = shown > 0;
      });
    });
  })();
</script>`;

function articlePage({ shell, article, all }) {
  const $ = load(shell, null, true);
  const idx = all.indexOf(article);
  const prev = all[idx - 1];
  const next = all[idx + 1];

  $('title').text(`${article.title} | Center Street Partners`);
  $('meta[name="description"]').attr('content', article.summary.slice(0, 300));
  $('meta[property="og:title"]').attr('content', article.title);
  $('meta[property="og:description"]').attr('content', article.summary.slice(0, 300));
  $('meta[property="og:url"]').attr('content', `https://cspwired.com/articles/${article.slug}`);
  $('meta[name="twitter:title"]').attr('content', article.title);
  $('meta[name="twitter:description"]').attr('content', article.summary.slice(0, 300));
  $('link[rel="canonical"]').attr('href', `https://cspwired.com/articles/${article.slug}`);

  // The homepage's local-business schema does not describe an article.
  $('script[type="application/ld+json"]').first().replaceWith(
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      datePublished: article.date || undefined,
      author: { '@type': 'Person', name: article.author },
      publisher: { '@type': 'Organization', name: 'Center Street Partners' },
      description: article.summary,
      mainEntityOfPage: `https://cspwired.com/articles/${article.slug}`,
    })}</script>`
  );

  const reviewFlag = article.needsReview
    ? `<div class="article-review-flag"><strong>Unreviewed conversion.</strong> This article came from a PDF, so its formatting is approximate. Replace the file in Drive with the Word or Google Doc original for a faithful version.</div>`
    : '';

  $('#article-main').replaceWith(`
<section class="article-page">
  <div class="container">
    <a class="article-back" href="/#articles">&larr; All articles</a>
    ${reviewFlag}
    <div class="section-label">${esc(metaLine(article))}</div>
    <h1>${esc(article.title)}</h1>
    <p class="article-byline">By ${esc(article.author)}</p>
    <div class="article-content">
${article.body}
    </div>
    <div class="article-next">
      ${prev ? `<a href="/articles/${esc(prev.slug)}">&larr; ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a href="/articles/${esc(next.slug)}">${esc(next.title)} &rarr;</a>` : '<span></span>'}
    </div>
  </div>
</section>`);

  return $.html();
}

/**
 * The source page inlines every image as base64 — including two 103KB hero
 * backgrounds inside the stylesheet, which sub-pages never display. Writing them
 * out as real files shrinks every page and lets the browser cache them across
 * the site instead of re-downloading them with each HTML document.
 */
async function externaliseInlineImages(html, assetDir) {
  await mkdir(assetDir, { recursive: true });
  const seen = new Map();
  let written = 0, saved = 0;

  const out = await replaceAsync(html, /data:(image\/[a-z.+-]+|application\/pdf);base64,([A-Za-z0-9+/=]{200,})/gi,
    async (whole, mime, b64) => {
      if (seen.has(b64)) return seen.get(b64);
      const buf = Buffer.from(b64, 'base64');
      const type = mime.split('/')[1];
      const ext = mime === 'application/pdf' ? 'pdf'
        : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
        : buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
        : type.replace('+xml', '').replace('jpeg', 'jpg').replace('x-icon', 'ico');
      const prefix = ext === 'pdf' ? 'doc' : 'img';
      const name = `${prefix}-${createHash('sha1').update(buf).digest('hex').slice(0, 10)}.${ext}`;
      await writeFile(path.join(assetDir, name), buf);
      const url = `/assets/${name}`;
      seen.set(b64, url);
      written += 1;
      saved += whole.length - url.length;
      return url;
    });

  return { html: out, written, saved };
}

/** String.replace with an async replacer. */
async function replaceAsync(str, re, fn) {
  const jobs = [];
  str.replace(re, (...args) => { jobs.push(fn(...args)); return ''; });
  const values = await Promise.all(jobs);
  let i = 0;
  return str.replace(re, () => values[i++]);
}

/**
 * Marketing copy written for the rebuild that has not been through compliance
 * review yet. Blocks between the PENDING-REVIEW markers are cut from the build
 * unless this is switched on, so the structural work (article URLs, page
 * weight, navigation) can ship without waiting on the new wording.
 *
 * To release it once compliance signs off:
 *   locally   -> npm run build:local -- --with-pending-copy
 *   on Netlify-> set INCLUDE_PENDING_COPY=1 in the site's environment variables
 */
export const includePendingCopy = () =>
  process.argv.includes('--with-pending-copy') || process.env.INCLUDE_PENDING_COPY === '1';

const PENDING_BLOCK = /<!--PENDING-REVIEW-->[\s\S]*?<!--\/PENDING-REVIEW-->/g;
const PENDING_MARKER = /<!--\/?PENDING-REVIEW-->/g;

/** Drop the unreviewed blocks, or just the markers when the copy is released. */
function applyPendingPolicy(html) {
  return includePendingCopy()
    ? html.replace(PENDING_MARKER, '')
    : html.replace(PENDING_BLOCK, '');
}

export async function render({ root, contentDir, distDir }) {
  const siteDir = path.join(root, 'site');
  const raw = applyPendingPolicy(await readFile(path.join(siteDir, 'index.source.html'), 'utf8'));
  const articles = await loadArticles(contentDir);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(path.join(distDir, 'articles'), { recursive: true });

  const extracted = await externaliseInlineImages(raw, path.join(distDir, 'assets'));
  const source = extracted.html;
  console.log(`  extracted ${extracted.written} inline image(s) to /assets (${Math.round(extracted.saved / 1024)} KB out of the HTML)`);

  // ---- homepage ----
  const $ = load(source);
  $('style').first().append(ARTICLES_CSS);
  $('#articles').html(articlesSection(articles));
  // the old inline articles are gone, so their expand/collapse handlers go too
  $('script').each((_, el) => {
    if (/expandArticle|collapseArticle/.test($(el).html() ?? '')) $(el).remove();
  });
  $('body').append(FILTER_JS);
  await writeFile(path.join(distDir, 'index.html'), $.html(), 'utf8');

  // ---- article pages, built from the homepage shell ----
  const $shell = load(source);
  $shell('style').first().append(ARTICLES_CSS);
  $shell('section, .trust-strip, .scroll-hint').remove();
  // drop the expand/collapse handlers that belonged to the old inline articles
  $shell('script').each((_, el) => {
    if (/expandArticle|collapseArticle/.test($shell(el).html() ?? '')) $shell(el).remove();
  });
  $shell('nav').after('<div id="article-main"></div>');
  // in-page nav links have to point back at the homepage from a sub-page
  $shell('.nav-links a[href^="#"], .footer-links a[href^="#"]').each((_, el) => {
    const href = $shell(el).attr('href');
    if (href && href !== '#') $shell(el).attr('href', `/${href}`);
  });
  $shell('.nav-brand').attr('href', '/');
  const shell = $shell.html();

  const readable = articles.filter((a) => a.status !== 'stub' && a.body.trim());
  for (const article of readable) {
    const html = articlePage({ shell, article, all: readable });
    await writeFile(path.join(distDir, 'articles', `${article.slug}.html`), html, 'utf8');
  }

  // ---- static passthrough ----
  const landingFrom = path.join(siteDir, 'landing-page.html');
  if (existsSync(landingFrom)) {
    // same treatment as the homepage: pull its inline base64 out into /assets
    const landing = await externaliseInlineImages(await readFile(landingFrom, 'utf8'), path.join(distDir, 'assets'));
    await writeFile(path.join(distDir, 'landing-page.html'), landing.html, 'utf8');
    console.log(`  landing page: ${landing.written} inline image(s) extracted (${Math.round(landing.saved / 1024)} KB)`);
  }
  for (const asset of ['og-image.jpg', 'robots.txt']) {
    const from = path.join(siteDir, asset);
    if (existsSync(from)) await cp(from, path.join(distDir, asset));
  }
  const imagesFrom = path.join(siteDir, 'articles', 'images');
  if (existsSync(imagesFrom)) {
    await cp(imagesFrom, path.join(distDir, 'articles', 'images'), { recursive: true });
  }

  // ---- sitemap now that every article has its own URL ----
  const urls = [
    { loc: 'https://cspwired.com/', priority: '1.0', freq: 'weekly' },
    { loc: 'https://cspwired.com/landing-page', priority: '0.8', freq: 'monthly' },
    ...readable.map((a) => ({
      loc: `https://cspwired.com/articles/${a.slug}`,
      priority: '0.7',
      freq: 'yearly',
      lastmod: a.date || undefined,
    })),
  ];
  await writeFile(
    path.join(distDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n` +
        (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
        `    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      ).join('\n') +
      `\n</urlset>\n`,
    'utf8'
  );

  // ---- _headers / _redirects ----
  // netlify.toml sits at the repo root, which a drag-and-drop deploy never
  // uploads — only the contents of dist/ are sent. These two files carry the
  // same rules inside the publish folder, so manual deploys keep the immutable
  // asset caching and the extensionless article URLs. They are harmless when
  // Netlify builds from git, where netlify.toml applies as well.
  await writeFile(
    path.join(distDir, '_headers'),
    [
      '# Filenames are content-hashed, so these can be cached indefinitely.',
      '/assets/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '/articles/images/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(distDir, '_redirects'),
    [
      '# Serve articles/<slug>.html at the canonical extensionless URL.',
      '/articles/:slug    /articles/:slug.html    200',
      '/landing-page      /landing-page.html      200',
      '',
    ].join('\n'),
    'utf8'
  );

  // ---- drop assets nothing links to ----
  // Images from the old inline articles get extracted before that markup is
  // replaced, so some land in /assets with no page left referencing them.
  const pages = [];
  const collect = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(full);
      else if (/\.(html|xml|css)$/i.test(entry.name)) pages.push(await readFile(full, 'utf8'));
    }
  };
  await collect(distDir);
  const allText = pages.join('\n');

  const assetDir = path.join(distDir, 'assets');
  let pruned = 0;
  if (existsSync(assetDir)) {
    for (const name of await readdir(assetDir)) {
      if (!allText.includes(`/assets/${name}`)) {
        await rm(path.join(assetDir, name));
        pruned += 1;
      }
    }
  }
  if (pruned) console.log(`  pruned ${pruned} unreferenced asset(s)`);

  return { articles, readable };
}
