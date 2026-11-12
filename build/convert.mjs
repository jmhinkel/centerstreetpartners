/**
 * Turns an uploaded document into clean article HTML.
 *
 * Google Docs and Word both carry real structure (headings, bold, lists, images),
 * so those convert faithfully. PDF does not — it is a layout format with no
 * semantics — so that path is best-effort and always flagged for review.
 */
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Word/Docs styles → semantic tags. Docs' own heading levels come through as Heading N. */
const STYLE_MAP = [
  "p[style-name='Title'] => h2:fresh",
  "p[style-name='Subtitle'] => p.article-subtitle:fresh",
  "p[style-name='Heading 1'] => h3:fresh",
  "p[style-name='Heading 2'] => h3:fresh",
  "p[style-name='Heading 3'] => h4:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

const ALLOWED_TAGS = [
  'h3', 'h4', 'p', 'strong', 'em', 'u', 'ol', 'ul', 'li', 'blockquote',
  'a', 'img', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'div', 'span',
];

const clean = (html) =>
  sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'loading'],
      div: ['class'],
      span: ['class'],
      p: ['class'],
    },
    transformTags: {
      a: (tag, attrs) => ({
        tagName: 'a',
        attribs: /^https?:/i.test(attrs.href || '')
          ? { ...attrs, target: '_blank', rel: 'noopener' }
          : attrs,
      }),
      img: (tag, attrs) => ({ tagName: 'img', attribs: { ...attrs, loading: 'lazy' } }),
    },
    // Docs exports are full of empty spacer paragraphs
    exclusiveFilter: (f) => ['p', 'span', 'div'].includes(f.tag) && !f.text.trim() && !/<img/i.test(f.tag),
  });

/**
 * @param {Buffer} buffer      the document bytes
 * @param {string} kind        'docx' | 'pdf'
 * @param {object} opts        { slug, imageDir, imagePublicPath }
 * @returns {{ html: string, warnings: string[], images: number, needsReview: boolean }}
 */
export async function convertDocument(buffer, kind, { slug, imageDir, imagePublicPath }) {
  if (kind === 'docx') return convertDocx(buffer, { slug, imageDir, imagePublicPath });
  if (kind === 'pdf') return convertPdf(buffer);
  throw new Error(`Unsupported document type: ${kind}`);
}

async function convertDocx(buffer, { slug, imageDir, imagePublicPath }) {
  let imageCount = 0;

  const convertImage = mammoth.images.imgElement(async (image) => {
    const bytes = await image.read();
    const ext = (image.contentType || 'image/png').split('/')[1].replace('jpeg', 'jpg').replace('+xml', '');
    const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8);
    const name = `${slug}-${hash}.${ext}`;
    await writeFile(path.join(imageDir, name), bytes);
    imageCount += 1;
    return { src: `${imagePublicPath}/${name}`, alt: image.altText || '' };
  });

  const result = await mammoth.convertToHtml(
    { buffer },
    { styleMap: STYLE_MAP, convertImage, ignoreEmptyParagraphs: true }
  );

  return {
    html: clean(result.value),
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message),
    images: imageCount,
    needsReview: false,
  };
}

async function convertPdf(buffer) {
  // pdf-parse reaches for a bundled sample file at import time in some versions,
  // so it is loaded lazily and only on the PDF path.
  const { default: pdfParse } = await import('pdf-parse');
  const { text } = await pdfParse(buffer);

  const lines = text.split('\n').map((l) => l.trim());
  const paragraphs = [];
  let current = [];

  for (const line of lines) {
    if (!line) {
      if (current.length) { paragraphs.push(current.join(' ')); current = []; }
      continue;
    }
    // drop page furniture: bare page numbers and repeated short all-caps runs
    if (/^\d{1,3}$/.test(line)) continue;
    current.push(line);
    // a line ending in sentence punctuation usually ends a paragraph in extracted text
    if (/[.!?]["')\]]?$/.test(line) && current.join(' ').length > 200) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join(' '));

  const html = paragraphs
    .filter((p) => p.length > 1)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
    .join('\n');

  return {
    html: clean(html),
    warnings: [
      'Converted from PDF: headings, pull-quotes, lists and images cannot be recovered from a PDF and have been flattened to paragraphs. Send the Word or Google Doc original for a faithful conversion.',
    ],
    images: 0,
    needsReview: true,
  };
}
