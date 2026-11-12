/**
 * Pulls the article library down from Google Drive into content/.
 *
 * Expected folder layout in Drive (folder name = category, so there is no
 * metadata form to fill in — where you put the file IS the category):
 *
 *   Center Street Partners Articles/
 *     Drafts/                  <- ignored; work in progress lives here
 *     Published/
 *       Legacy Builders/
 *       Gold Report/
 *       Jay's Articles/
 *
 * Filenames may optionally lead with a date and issue number:
 *   "2026-04-10 #22 Why Finance Is Just As Important.docx"
 *   "Wars and Rumors of Wars.docx"
 * Anything omitted falls back to Drive's own modified date.
 *
 * Drive is the authoring surface, but content/ is committed to the repo — so
 * every published version is in Git history, which is also the audit trail.
 */
import { google } from 'googleapis';
import { writeFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { convertDocument } from './convert.mjs';

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const FOLDER = 'application/vnd.google-apps.folder';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const slugify = (s) =>
  s.toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** "2026-04-10 #22 Some Title.docx" -> { date, issue, title } */
export function parseFilename(name) {
  let rest = name.replace(/\.(docx?|pdf)$/i, '').trim();
  let date = null;
  let issue = null;

  const dateMatch = /^(\d{4}-\d{2}-\d{2})\s+/.exec(rest);
  if (dateMatch) { date = dateMatch[1]; rest = rest.slice(dateMatch[0].length); }

  const issueMatch = /^#(\d+)\s+/.exec(rest);
  if (issueMatch) { issue = Number(issueMatch[1]); rest = rest.slice(issueMatch[0].length); }

  return { date, issue, title: rest.trim() };
}

function authorise() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const creds = JSON.parse(raw);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

const listChildren = async (drive, parentId, extra = '') => {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false ${extra}`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
};

async function download(drive, file) {
  // Native Docs must be exported; uploaded files are downloaded as-is.
  const req = file.mimeType === GOOGLE_DOC
    ? drive.files.export({ fileId: file.id, mimeType: DOCX }, { responseType: 'arraybuffer' })
    : drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from((await req).data);
}

export async function syncDrive({ contentDir, imageDir, imagePublicPath, rootFolderId }) {
  const drive = google.drive({ version: 'v3', auth: authorise() });
  await mkdir(imageDir, { recursive: true });

  const top = await listChildren(drive, rootFolderId, `and mimeType = '${FOLDER}'`);
  const published = top.find((f) => f.name.toLowerCase() === 'published');
  if (!published) {
    throw new Error(`No "Published" folder inside the configured Drive folder (found: ${top.map(f => f.name).join(', ') || 'nothing'})`);
  }

  const categories = await listChildren(drive, published.id, `and mimeType = '${FOLDER}'`);
  const seen = [];
  const problems = [];

  for (const category of categories) {
    const files = await listChildren(drive, category.id, `and mimeType != '${FOLDER}'`);

    for (const file of files) {
      const kind = file.mimeType === GOOGLE_DOC || file.mimeType === DOCX ? 'docx'
        : file.mimeType === 'application/pdf' ? 'pdf'
        : null;

      if (!kind) {
        problems.push(`Skipped "${file.name}" in ${category.name}: unsupported type (${file.mimeType})`);
        continue;
      }

      const { date, issue, title } = parseFilename(file.name);
      const slug = slugify(title);
      if (!slug) { problems.push(`Skipped "${file.name}": could not derive a title`); continue; }

      const dir = path.join(contentDir, slug);
      await mkdir(dir, { recursive: true });

      let converted;
      try {
        const buffer = await download(drive, file);
        converted = await convertDocument(buffer, kind, { slug, imageDir, imagePublicPath });
      } catch (err) {
        problems.push(`Failed to convert "${file.name}": ${err.message}`);
        continue;
      }

      // First paragraph doubles as the listing summary unless one is already recorded.
      const firstPara = /<p>([\s\S]*?)<\/p>/.exec(converted.html)?.[1] ?? '';
      const summary = firstPara.replace(/<[^>]+>/g, '').trim().slice(0, 320);

      const record = {
        slug,
        title,
        category: category.name,
        issue,
        // Parens are required: mixing ?? and || without them is a SyntaxError.
        date: date ?? ((file.modifiedTime ?? file.createdTime ?? '').slice(0, 10) || null),
        author: category.name === "Jay's Articles" ? 'Jay Hinkel' : 'Brad Skiles',
        summary,
        tracking: /Tracking #(\d+)/.exec(converted.html)?.[1] ?? null,
        status: 'published',
        featured: false,
        source: 'drive',
        driveFileId: file.id,
        driveModified: file.modifiedTime,
        needsReview: converted.needsReview,
        warnings: converted.warnings,
        images: converted.images,
      };

      await writeFile(path.join(dir, 'article.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
      await writeFile(path.join(dir, 'body.html'), converted.html.trim() + '\n', 'utf8');

      seen.push(record);
      const flag = converted.needsReview ? ' [NEEDS REVIEW]' : '';
      console.log(`  drive  ${category.name.padEnd(16)} ${title.slice(0, 48).padEnd(48)} ${converted.images} img${flag}`);
      converted.warnings.forEach((w) => console.log(`         ! ${w}`));
    }
  }

  // ---- retire articles that are no longer in Drive ----
  // Without this, unpublishing is impossible: deleting a file in Drive (or moving
  // it back to Drafts) leaves the last synced copy in content/, so it keeps
  // building into the site forever. Only articles this sync owns are considered
  // — the seeded ones migrated out of the old hardcoded HTML have no
  // `source: 'drive'` and must survive.
  const live = new Set(seen.map((a) => a.slug));
  const removed = [];
  for (const entry of await readdir(contentDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || live.has(entry.name)) continue;
    const metaPath = path.join(contentDir, entry.name, 'article.json');
    if (!existsSync(metaPath)) continue;
    let meta;
    try { meta = JSON.parse(await readFile(metaPath, 'utf8')); } catch { continue; }
    if (meta.source !== 'drive') continue;
    await rm(path.join(contentDir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  removed.forEach((slug) => console.log(`  retired  ${slug} (no longer in Drive/Published)`));

  problems.forEach((p) => console.warn(`  ! ${p}`));
  return { synced: seen, removed, problems };
}
