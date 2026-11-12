/**
 * Site build. Netlify runs this on every deploy.
 *
 *   1. If Drive credentials are present, pull the article library down into content/.
 *   2. Render content/ + site/ into dist/.
 *
 * Step 1 is skipped when credentials are absent, so the site still builds from the
 * committed content/ folder — a Drive outage or a bad key can never take the site down.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const IMAGES = path.join(ROOT, 'site', 'articles', 'images');

const run = async () => {
  const folderId = process.env.DRIVE_ARTICLES_FOLDER_ID;
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  // --local also works as ARTICLE_SOURCE=local, since `VAR=x cmd` is not valid on Windows shells
  const skipSync = process.argv.includes('--local') || process.env.ARTICLE_SOURCE === 'local';

  if (skipSync) {
    console.log('Drive sync skipped (ARTICLE_SOURCE=local)');
  } else if (folderId && creds) {
    console.log('Syncing articles from Google Drive...');
    try {
      const { syncDrive } = await import('./sync-drive.mjs');
      const { synced, problems } = await syncDrive({
        contentDir: CONTENT,
        imageDir: IMAGES,
        imagePublicPath: '/articles/images',
        rootFolderId: folderId,
      });
      console.log(`Drive sync complete: ${synced.length} article(s), ${problems.length} problem(s)`);
    } catch (err) {
      // A Drive failure must not fail the deploy — fall back to committed content.
      console.error(`Drive sync FAILED, building from committed content instead: ${err.message}`);
    }
  } else {
    console.log('Drive not configured (DRIVE_ARTICLES_FOLDER_ID / GOOGLE_SERVICE_ACCOUNT_JSON) — building from content/');
  }

  console.log('Rendering site...');
  const { articles, readable } = await render({ root: ROOT, contentDir: CONTENT, distDir: DIST });

  const byCategory = readable.reduce((acc, a) => ({ ...acc, [a.category]: (acc[a.category] ?? 0) + 1 }), {});
  console.log(`\nBuilt ${readable.length} article page(s) from ${articles.length} record(s)`);
  Object.entries(byCategory).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  const flagged = readable.filter((a) => a.needsReview);
  if (flagged.length) console.log(`\n${flagged.length} article(s) flagged for review (PDF conversions)`);
  console.log('\nOutput: dist/');
};

run().catch((err) => { console.error(err); process.exit(1); });
