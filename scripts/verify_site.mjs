import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContent, ROOT, CATEGORY_SLUGS } from './build_site.mjs';

export function verifySite() {
  const { articles, categories } = readContent();
  if (articles.length < 1) throw new Error('No articles');
  if (new Set(articles.map(a => a.id)).size !== articles.length) throw new Error('Duplicate IDs');
  const locations = ['index.html', 'archive/index.html',
    ...categories.map(c => `categories/${CATEGORY_SLUGS[c.id]}/index.html`),
    ...articles.map(a => `articles/${a.id}/index.html`)];
  const errors = [];
  for (const a of articles) {
    const source = path.join(ROOT, 'content', 'posts', a.id + '.md');
    if (!fs.existsSync(source) || !fs.readFileSync(source, 'utf8').trim()) errors.push('Missing Markdown: ' + a.id);
  }
  for (const location of locations) {
    const target = path.join(ROOT, location);
    if (!fs.existsSync(target)) { errors.push('Missing HTML: ' + location); continue; }
    const html = fs.readFileSync(target, 'utf8');
    if (!/<html lang="zh-CN">/.test(html)) errors.push('Invalid HTML: ' + location);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1].replaceAll('&amp;', '&');
      if (/^(?:https?:|mailto:|#|\/)/.test(url)) continue;
      const cleanURL = url.split('#')[0].split('?')[0];
      if (!cleanURL) continue;
      const linked = path.resolve(path.dirname(target), decodeURIComponent(cleanURL));
      if (!linked.startsWith(ROOT + path.sep) || !fs.existsSync(linked)) {
        errors.push(`Broken link: ${location} -> ${url}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.slice(0, 15).join('\n'));
  return { pages: locations.length, articles: articles.length, categories: categories.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log('Validation passed:', verifySite()); }
  catch (err) { console.error(err); process.exitCode = 1; }
}
