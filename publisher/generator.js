/* Offline blog engine: standard browser JavaScript + File System Access API.
   No Node.js, Python, HTTP service, GitHub token or Git push. */
(function () {
  'use strict';

  const CATEGORY_SLUGS = { 1: 'notes', 2: 'php', 3: 'go', 4: 'frontend' };
  const BASE_URL = 'https://yinjiaming666.github.io/blog/';
  const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const prefixFor = (location) => '../'.repeat(location.split('/').length - 1);
  const fullURL = (base, url) => base.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
  const sortArticles = (arr) => [...arr].sort((a, b) => b.unix_time - a.unix_time || b.id - a.id);
  const dateOf = (a) => a.created_at.slice(0, 10);
  const normalized = (str) => String(str).replace(/[ \t]+$/gm, '');
  const output = (filename, text) => ({ filename, text: normalized(text) });

  function splitPath(filePath) {
    const parts = filePath.split('/');
    if (parts.length === 0 || parts.some(part => !part || part === '.' || part === '..')) {
      throw new Error('无效文件路径：' + filePath);
    }
    return parts;
  }

  async function getParent(directory, filePath, create) {
    const parts = splitPath(filePath);
    const fileName = parts.pop();
    let current = directory;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: Boolean(create) });
    }
    return { parent: current, fileName };
  }

  async function readText(directory, filePath) {
    const { parent, fileName } = await getParent(directory, filePath, false);
    const handle = await parent.getFileHandle(fileName);
    return (await handle.getFile()).text();
  }

  async function writeText(directory, filePath, contents) {
    const { parent, fileName } = await getParent(directory, filePath, true);
    const handle = await parent.getFileHandle(fileName, { create: true });
    const stream = await handle.createWritable();
    await stream.write(contents);
    await stream.close();
  }

  function localISO(epoch = Date.now()) {
    const time = new Date(epoch);
    const digits = number => String(number).padStart(2, '0');
    const offset = -time.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    return String(time.getFullYear()) + '-' + digits(time.getMonth() + 1) + '-' + digits(time.getDate()) +
      'T' + digits(time.getHours()) + ':' + digits(time.getMinutes()) + ':' + digits(time.getSeconds()) +
      sign + digits(Math.floor(Math.abs(offset) / 60)) + ':' + digits(Math.abs(offset) % 60);
  }

  async function readMetadata(directory) {
    const json = JSON.parse(await readText(directory, 'content/articles.json'));
    if (!Array.isArray(json.categories) || !Array.isArray(json.articles)) {
      throw new Error('content/articles.json 格式错误');
    }
    const known = new Set(json.categories.map(c => c.id));
    if (json.categories.some(c => !CATEGORY_SLUGS[c.id])) throw new Error('发现未知分类');
    if (new Set(json.articles.map(a => a.id)).size !== json.articles.length) {
      throw new Error('文章 ID 重复');
    }
    for (const a of json.articles) {
      if (!Number.isSafeInteger(a.id) || a.id <= 0 ||
          !known.has(a.category_id) || a.source !== 'content/posts/' + a.id + '.md') {
        throw new Error('文章元数据错误：' + String(a.id));
      }
    }
    return json;
  }

  async function loadProject(directory) {
    await readText(directory, 'style.css'); // confirm this is the blog root
    return readMetadata(directory);
  }

  async function readArticle(directory, id) {
    const data = await readMetadata(directory);
    const article = data.articles.find(a => a.id === id);
    if (!article) throw new Error('找不到文章 #' + id);
    return Object.assign({}, article, { body: await readText(directory, article.source) });
  }

  async function saveArticle(directory, input) {
    const data = await readMetadata(directory);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body : '';
    const categoryId = Number(input.category_id);
    if (!title || title.length > 250) throw new Error('请输入不超过 250 字的标题');
    if (!body.trim()) throw new Error('请输入文章内容');
    if (!data.categories.some(category => category.id === categoryId)) throw new Error('请选择正确的分类');
    if (new TextEncoder().encode(body).byteLength > 2 * 1024 * 1024) throw new Error('文章正文不能超过 2MB');

    const previous = input.id == null ? null : data.articles.find(a => a.id === Number(input.id));
    if (input.id != null && !previous) throw new Error('这篇文章已不存在，请重新选择');
    const id = previous ? previous.id : Math.max(0, ...data.articles.map(a => a.id)) + 1;
    const now = Date.now();
    const record = previous
      ? Object.assign({}, previous, { title, category_id: categoryId })
      : { id, title, category_id: categoryId, created_at: localISO(now),
          unix_time: Math.floor(now / 1000), source: 'content/posts/' + id + '.md',
          original_format: 'markdown' };

    const existingBody = previous ? await readText(directory, record.source) : null;
    const metadataBefore = JSON.stringify(data, null, 2) + '\n';
    if (previous) Object.assign(previous, record);
    else data.articles.push(record);
    data.articles = sortArticles(data.articles);
    try {
      await writeText(directory, record.source, body);
      await writeText(directory, 'content/articles.json', JSON.stringify(data, null, 2) + '\n');
    } catch (err) {
      if (existingBody !== null) {
        try { await writeText(directory, record.source, existingBody); } catch { /* keep original error */ }
      } else {
        try {
          const { parent, fileName } = await getParent(directory, record.source, false);
          await parent.removeEntry(fileName);
        } catch { /* keep original error */ }
      }
      try { await writeText(directory, 'content/articles.json', metadataBefore); } catch { /* keep original error */ }
      throw err;
    }
    return Object.assign({}, record, { body });
  }

  function renderMarkdown(markdownText, title) {
    if (!globalThis.marked || typeof globalThis.marked.parse !== 'function') {
      throw new Error('Markdown 解析器未加载');
    }
    let html = globalThis.marked.parse(markdownText, { gfm: true, breaks: false });
    const match = markdownText.match(/^\s*#\s+(.+?)\s*(?:\n|$)/);
    if (match && match[1].replace(/\s+#+$/, '').trim().toLowerCase() === String(title || '').trim().toLowerCase()) {
      html = html.replace(/^<h1>.*?<\/h1>\s*/s, '');
    }
    return html;
  }

  function navigation(prefix, current, categories) {
    const items = [
      ['首页', prefix + 'index.html', current === 'home'],
      ['归档', prefix + 'archive/index.html', current === 'archive']
    ];
    for (const category of categories) {
      const slug = CATEGORY_SLUGS[category.id];
      items.push([category.name, prefix + 'categories/' + slug + '/index.html', current === slug]);
    }
    return items.map(([label, href, currentPage]) =>
      '<a href="' + esc(href) + '"' + (currentPage ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>'
    ).join(' ');
  }

  function page({ title, description, body, location, current, categories, baseURL }) {
    const prefix = prefixFor(location);
    const canonical = fullURL(baseURL, location === 'index.html' ? '' : location.replace(/index\.html$/, ''));
    return '<!doctype html>\n<html lang="zh-CN">\n<head>\n' +
      '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + esc(title) + '</title>\n' +
      '<meta name="description" content="' + esc(description) + '">\n' +
      '<link rel="canonical" href="' + esc(canonical) + '">\n' +
      '<link rel="stylesheet" href="' + esc(prefix) + 'style.css">\n' +
      '</head>\n<body>\n<nav aria-label="网站导航">' + navigation(prefix, current, categories) +
      '</nav>\n<hr>\n<main>\n' + body + '\n</main>\n</body>\n</html>\n';
  }

  function item(a, prefix, categories, showCategory = true) {
    const category = categories.get(a.category_id);
    const catLink = prefix + 'categories/' + CATEGORY_SLUGS[a.category_id] + '/index.html';
    const tag = showCategory
      ? ' <span class="post-category">[<a href="' + esc(catLink) + '">' + esc(category.name) + '</a>]</span>'
      : '';
    const date = dateOf(a);
    return '<li><time datetime="' + esc(date) + '">' + esc(date) +
      '</time><span class="post-entry"><a class="article-title" href="' + esc(prefix) +
      'articles/' + a.id + '/index.html">' + esc(a.title) + '</a>' + tag + '</span></li>';
  }

  function itemList(articles, prefix, categories, showCategory = true) {
    return '<ul class="post-list">\n' +
      articles.map(a => item(a, prefix, categories, showCategory)).join('\n') + '\n</ul>';
  }

  async function buildSite(directory, onProgress = () => {}) {
    const data = await loadProject(directory);
    const categories = data.categories;
    const articles = sortArticles(data.articles);
    const lookup = new Map(categories.map(c => [c.id, c]));
    const outputFiles = [];

    // Read and validate all posts before overwriting generated HTML.
    const sourceTexts = [];
    for (const a of articles) {
      const source = await readText(directory, a.source);
      if (!source.trim()) throw new Error('文章内容为空：#' + a.id);
      sourceTexts.push(source);
    }

    outputFiles.push(output('index.html', page({
      title: '文章', description: 'Go、PHP 与前端开发文章',
      body: itemList(articles, '', lookup), location: 'index.html',
      current: 'home', categories, baseURL: BASE_URL
    })));
    for (const category of categories) {
      const slug = CATEGORY_SLUGS[category.id];
      const subset = articles.filter(a => a.category_id === category.id);
      const location = 'categories/' + slug + '/index.html';
      outputFiles.push(output(location, page({
        title: category.name, description: category.name + ' 分类文章',
        body: '<h1>' + esc(category.name) + '</h1>' + itemList(subset, '../../', lookup, false),
        location, current: slug, categories, baseURL: BASE_URL
      })));
    }

    const byYear = new Map();
    for (const a of articles) {
      const year = dateOf(a).slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(a);
    }
    const archive = ['<h1>文章归档</h1>'];
    for (const year of [...byYear.keys()].sort().reverse()) {
      archive.push('<h2>' + esc(year) + '</h2>', itemList(byYear.get(year), '../', lookup));
    }
    outputFiles.push(output('archive/index.html', page({
      title: '文章归档', description: '按年份浏览全部文章',
      body: archive.join('\n'), location: 'archive/index.html', current: 'archive',
      categories, baseURL: BASE_URL
    })));

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const category = lookup.get(a.category_id);
      const catLink = '../../categories/' + CATEGORY_SLUGS[a.category_id] + '/index.html';
      const heading = '<h1>' + esc(a.title) + '</h1>' +
        '<p class="post-meta"><time datetime="' + esc(dateOf(a)) + '">' + esc(dateOf(a)) +
        '</time> · <a href="' + esc(catLink) + '">' + esc(category.name) + '</a></p>';
      const body = heading + '<article class="prose">\n' +
        renderMarkdown(sourceTexts[i], a.title) + '\n</article>';
      const location = 'articles/' + a.id + '/index.html';
      outputFiles.push(output(location, page({
        title: a.title, description: a.title + ' - ' + category.name, body,
        location, current: '', categories, baseURL: BASE_URL
      })));
    }

    const paths = ['', 'archive/']
      .concat(categories.map(c => 'categories/' + CATEGORY_SLUGS[c.id] + '/'))
      .concat(articles.map(a => 'articles/' + a.id + '/'));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      paths.map(p => '<url><loc>' + esc(fullURL(BASE_URL, p)) + '</loc></url>').join('') +
      '</urlset>\n';
    outputFiles.push(output('sitemap.xml', xml));
    outputFiles.push(output('robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + fullURL(BASE_URL, 'sitemap.xml') + '\n'));
    outputFiles.push(output('.nojekyll', ''));

    // Never delete user files or issue Git commands. Updating pages is deterministic.
    const total = outputFiles.length;
    for (let i = 0; i < total; i++) {
      const generated = outputFiles[i];
      await writeText(directory, generated.filename, generated.text);
      if (i % 8 === 0 || i === total - 1) onProgress(i + 1, total);
    }
    return { articles: articles.length, categories: categories.length, pages: paths.length, written: total };
  }

  globalThis.BlogStatic = Object.freeze({
    readText, writeText, readMetadata, loadProject, readArticle, saveArticle,
    renderMarkdown, buildSite, CATEGORY_SLUGS, BASE_URL
  });
})();
