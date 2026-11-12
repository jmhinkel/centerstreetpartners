/**
 * Pulls Drive -> content/ and stops. No rendering.
 *
 * This is the CI entry point. The split matters for the audit trail:
 *
 *   GitHub Action  ->  sync Drive into content/, commit the result
 *   Netlify        ->  build the site from that commit, never touching Drive
 *
 * Netlify's filesystem is thrown away after each deploy, so if the Drive sync
 * ran there, content/ would exist only for the length of a build and no record
 * of what was published would survive. Committing content/ from CI means every
 * published version — and every edit to one — is a commit with a timestamp,
 * which is what a compliance review actually needs to look at.
 *
 *   node build/sync-only.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncDrive } from './sync-drive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = async () => {
  const rootFolderId = process.env.DRIVE_ARTICLES_FOLDER_ID;
  if (!rootFolderId) throw new Error('DRIVE_ARTICLES_FOLDER_ID is not set');
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');

  console.log('Syncing articles from Google Drive...');
  const { synced, removed, problems } = await syncDrive({
    contentDir: path.join(ROOT, 'content'),
    imageDir: path.join(ROOT, 'site', 'articles', 'images'),
    imagePublicPath: '/articles/images',
    rootFolderId,
  });

  console.log(`\n${synced.length} article(s) in Drive/Published`);
  const byCategory = synced.reduce((a, x) => ({ ...a, [x.category]: (a[x.category] ?? 0) + 1 }), {});
  Object.entries(byCategory).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  if (removed.length) console.log(`\nRetired ${removed.length}: ${removed.join(', ')}`);

  const flagged = synced.filter((a) => a.needsReview);
  if (flagged.length) {
    console.log(`\n${flagged.length} article(s) FLAGGED FOR REVIEW:`);
    flagged.forEach((a) => console.log(`  ${a.title} — ${a.warnings.join('; ')}`));
  }

  // Problems are reported but are not fatal: one malformed file must not stop
  // the other articles from publishing.
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    problems.forEach((p) => console.log(`  ! ${p}`));
  }
};

run().catch((err) => { console.error(`Sync failed: ${err.message}`); process.exit(1); });
