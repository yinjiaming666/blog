import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILE = path.join(ROOT, 'content', 'articles.json');
export const CATEGORY_SLUGS = { 1: 'notes', 2: 'php', 3: 'go', 4: 'frontend' };
const BASE_URL = 'https://yinjiaming666.github.io/blog/';

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const rel = (location) => '../'.repeat(location.split('/').length - 1);
const absolute = (base, location) => base.replace(/\/$/, '') + '/' + location.replace(/^\//, '');
const dateOf = (article) => article.created_at.slice(0, 10);
const file = (location, text) => {
  const target = path.join(ROOT, location);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Preserve Markdown sources; normalize inconsequential trailing whitespace in generated HTML.
  fs.writeFileSync(target, text.replace(/[ \t]+$/gm, ''), 'utf8');
};
function navigation(prefix, current, categories) {
  const links = [['首页', prefix + 'index.html', current === 'home'], ['归档', prefix + 'archive/index.html', current === 'archive']];
  for (const category of categories) {
    const slug = CATEGORY_SLUGS[category.id];
    links.push([category.name, prefix + 'categories/' + slug + '/index.html', current === slug]);
  }
  return links.map(([name, link, active]) => `<a href="${esc(link)}"${active ? ' aria-current="page"' : ''}>${esc(name)}</a>`).join(' ');
}
function page({ title, description, body, location, current, categories, baseURL }) {
  const prefix = rel(location);
  const canonical = absolute(baseURL, location === 'index.html' ? '' : location.replace(/index\.html$/, ''));
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="${esc(prefix)}style.css">
</head>
<body>
<nav aria-label="网站导航">${navigation(prefix, current, categories)}</nav>
<hr>
<main>
${body}
</main>
</body>
</html>
`;
}
function item(a, prefix, categories, showCategory = true) {
  const cat = categories.get(a.category_id);
  const catLink = prefix + 'categories/' + CATEGORY_SLUGS[a.category_id] + '/index.html';
  const category = showCategory ? ` <span class="post-category">[<a href="${esc(catLink)}">${esc(cat.name)}</a>]</span>` : '';
  const date = dateOf(a);
  return `<li><time datetime="${esc(date)}">${esc(date)}</time><span class="post-entry"><a class="article-title" href="${esc(prefix)}articles/${a.id}/index.html">${esc(a.title)}</a>${category}</span></li>`;
}
const itemList = (articles, prefix, categories, showCategory = true) =>
  '<ul class="post-list">\n' + articles.map(a => item(a, prefix, categories, showCategory)).join('\n') + '\n</ul>';

export function renderMarkdown(source, title = '') {
  let result = marked.parse(source, { gfm: true, breaks: false });
  // Avoid duplicating the article title when it matches the first Markdown heading.
  const first = source.match(/^\s*#\s+(.+?)\s*(?:\n|$)/);
  if (first && first[1].replace(/\s+#+$/, '').trim().toLowerCase() === title.trim().toLowerCase()) {
    result = result.replace(/^<h1>.*?<\/h1>\s*/s, '');
  }
  return result;
}
export function readContent() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(data.articles) || !Array.isArray(data.categories)) throw new Error('Invalid articles metadata');
  return data;
}
export function buildSite(baseURL = BASE_URL) {
  if (!/^https:\/\//.test(baseURL) || !baseURL.endsWith('/')) throw new Error('baseURL must be HTTPS and end with /');
  const data = readContent();
  const categories = data.categories;
  const articles = [...data.articles].sort((a, b) => b.unix_time - a.unix_time || b.id - a.id);
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  if (new Set(articles.map(a => a.id)).size !== articles.length) throw new Error('Duplicate article ID');
  for (const a of articles) {
    if (!categoryMap.has(a.category_id) || !CATEGORY_SLUGS[a.category_id]) throw new Error(`Invalid category for article ${a.id}`);
    if (!Number.isInteger(a.id) || a.id <= 0 || a.source !== `content/posts/${a.id}.md`) throw new Error('Invalid article source');
    if (!fs.existsSync(path.join(ROOT, a.source))) throw new Error(`Missing: ${a.source}`);
  }

  for (const folder of ['articles', 'categories', 'archive']) {
    fs.rmSync(path.join(ROOT, folder), { recursive: true, force: true });
  }

  file('index.html', page({
    title: '文章', description: 'Go、PHP 与前端开发文章', body: itemList(articles, '', categoryMap),
    location: 'index.html', current: 'home', categories, baseURL,
  }));

  for (const cat of categories) {
    const slug = CATEGORY_SLUGS[cat.id];
    const subset = articles.filter(a => a.category_id === cat.id);
    const location = `categories/${slug}/index.html`;
    file(location, page({
      title: cat.name, description: `${cat.name} 分类文章`,
      body: `<h1>${esc(cat.name)}</h1>${itemList(subset, '../../', categoryMap, false)}`,
      location, current: slug, categories, baseURL,
    }));
  }

  const byYear = new Map();
  for (const a of articles) {
    const year = dateOf(a).slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(a);
  }
  const archive = ['<h1>文章归档</h1>'];
  for (const year of [...byYear.keys()].sort().reverse()) {
    archive.push(`<h2>${esc(year)}</h2>`, itemList(byYear.get(year), '../', categoryMap));
  }
  file('archive/index.html', page({
    title: '文章归档', description: '按年份浏览全部文章', body: archive.join('\n'),
    location: 'archive/index.html', current: 'archive', categories, baseURL,
  }));

  for (const a of articles) {
    const category = categoryMap.get(a.category_id);
    const source = fs.readFileSync(path.join(ROOT, a.source), 'utf8');
    if (!source.trim()) throw new Error(`Empty article: ${a.id}`);
    const catLink = '../../categories/' + CATEGORY_SLUGS[a.category_id] + '/index.html';
    const body = `<h1>${esc(a.title)}</h1><p class="post-meta"><time datetime="${esc(dateOf(a))}">${esc(dateOf(a))}</time> · <a href="${esc(catLink)}">${esc(category.name)}</a></p><article class="prose">\n${renderMarkdown(source, a.title)}\n</article>`;
    const location = `articles/${a.id}/index.html`;
    file(location, page({
      title: a.title, description: a.title + ' - ' + category.name,
      body, location, current: '', categories, baseURL,
    }));
  }

  const locations = ['', 'archive/', ...categories.map(c => `categories/${CATEGORY_SLUGS[c.id]}/`),
    ...articles.map(a => `articles/${a.id}/`)];
  const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + locations.map(location => `<url><loc>${esc(absolute(baseURL, location))}</loc></url>`).join('')
    + '</urlset>\n';
  file('sitemap.xml', sitemap);
  file('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${absolute(baseURL, 'sitemap.xml')}\n`);
  file('.nojekyll', '');
  return { articles: articles.length, categories: categories.length, pages: locations.length, baseURL };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--base-url');
  try { console.log('Build complete:', buildSite(flag >= 0 ? process.argv[flag + 1] : BASE_URL)); }
  catch (err) { console.error(err); process.exitCode = 1; }
}
