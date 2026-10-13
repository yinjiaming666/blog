/* Offline blog engine: standard browser JavaScript + File System Access API.
   No Node.js, Python, HTTP service, GitHub token or Git push. */
(function () {
  'use strict';

  const CATEGORY_SLUGS = { 1: 'notes', 2: 'php', 3: 'go', 4: 'frontend' };
  const BASE_URL = 'https://yinjiaming666.github.io/blog/';
  const SITE_NAME = 'yinjiaming的博客';
  const AUTHOR = 'yinjiaming';
  const SITE_DESCRIPTION = 'yinjiaming的博客，记录 Go、PHP、Flutter、Vue 和前端开发中的技术实践、问题排查与解决方法。';
  const SHARE_IMAGE = BASE_URL + 'social-card.png';
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
    if (previous && (previous.title !== title || previous.category_id !== categoryId || existingBody !== body)) {
      record.updated_at = localISO(now);
    }
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

  // Summaries use real Markdown prose rather than repeating only the title or category.
  // marked.lexer ignores fenced code blocks and produces paragraph tokens.
  function plainText(value) {
    return String(value)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, entity => ({
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' '
      })[entity.toLowerCase()] || entity)
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
        const num = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
        return Number.isInteger(num) && num > 0 && num <= 0x10ffff ? String.fromCodePoint(num) : ' ';
      })
      .replace(/[`*~]+/g, '')
      .replace(/\bhttps?:\/\/[^\s]+/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function truncate(value, max = 155) {
    const chars = Array.from(plainText(value));
    return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('').trimEnd() + '…';
  }

  function articleDescription(markdownText, title, categoryName) {
    const tokens = globalThis.marked.lexer(markdownText, { gfm: true });
    const fragments = [];
    function collect(list) {
      for (const token of list) {
        if (fragments.join(' ').length > 270) break;
        if (token.type === 'paragraph' || token.type === 'text' || token.type === 'heading') {
          const value = plainText(token.text);
          // Skip heading-only labels and attribution links; favor meaningful source text.
          if (value && value !== title && Array.from(value).length >= 12 &&
              !/^(参考|原文|原博文地址|来源|更多信息)\s*[:：]?$/i.test(value)) fragments.push(value);
        } else if (token.type === 'blockquote') {
          collect(token.tokens || []);
        }
      }
    }
    collect(tokens);
    if (fragments.length) return truncate(fragments.join(' '));
    // If an article contains only code or tables, do not invent a summary.
    return truncate(title + '。' + SITE_NAME + '中关于' + categoryName + '的技术文章。');
  }

  function jsonLD(data) {
    // Prevent article titles from ending the JSON-LD script or injecting markup.
    return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function breadcrumbs(items) {
    return {
      '@type': 'BreadcrumbList',
      itemListElement: items.map(([name, url], i) => ({
        '@type': 'ListItem', position: i + 1, name, item: url
      }))
    };
  }

  function page({ title, description, body, location, current, categories, baseURL,
                  type = 'website', article = null, category = null, ld = [] }) {
    const prefix = prefixFor(location);
    const canonical = fullURL(baseURL, location === 'index.html' ? '' : location.replace(/index\.html$/, ''));
    const fullTitle = location === 'index.html' ? SITE_NAME : title + ' | ' + SITE_NAME;
    const summary = truncate(description);
    const entities = ld.map(entity => ({ ...entity, '@context': 'https://schema.org' }));
    if (article) {
      entities.push({
        '@context': 'https://schema.org', '@type': 'BlogPosting',
        headline: article.title, description: summary, url: canonical,
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        datePublished: article.created_at,
        ...(article.updated_at ? { dateModified: article.updated_at } : {}),
        author: { '@type': 'Person', name: AUTHOR },
        publisher: { '@type': 'Person', name: AUTHOR },
        image: SHARE_IMAGE, articleSection: category.name,
        inLanguage: 'zh-CN', isPartOf: { '@id': fullURL(baseURL, '#blog') }
      });
      entities.push({ '@context': 'https://schema.org',
        ...breadcrumbs([
          [SITE_NAME, baseURL], [category.name, fullURL(baseURL, 'categories/' + CATEGORY_SLUGS[category.id] + '/')],
          [article.title, canonical]
        ])
      });
    }
    const seo = [
      '<title>' + esc(fullTitle) + '</title>',
      '<meta name="description" content="' + esc(summary) + '">',
      '<meta name="author" content="' + esc(AUTHOR) + '">',
      '<link rel="canonical" href="' + esc(canonical) + '">',
      '<meta property="og:type" content="' + type + '">',
      '<meta property="og:site_name" content="' + esc(SITE_NAME) + '">',
      '<meta property="og:locale" content="zh_CN">',
      '<meta property="og:title" content="' + esc(fullTitle) + '">',
      '<meta property="og:description" content="' + esc(summary) + '">',
      '<meta property="og:url" content="' + esc(canonical) + '">',
      '<meta property="og:image" content="' + esc(SHARE_IMAGE) + '">',
      '<meta property="og:image:type" content="image/png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta property="og:image:alt" content="' + esc(SITE_NAME) + '">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="' + esc(fullTitle) + '">',
      '<meta name="twitter:description" content="' + esc(summary) + '">',
      '<meta name="twitter:image" content="' + esc(SHARE_IMAGE) + '">'
    ];
    if (article) {
      seo.push('<meta property="article:published_time" content="' + esc(article.created_at) + '">');
      if (article.updated_at) seo.push('<meta property="article:modified_time" content="' + esc(article.updated_at) + '">');
      seo.push('<meta property="article:section" content="' + esc(category.name) + '">');
    }
    for (const item of entities) {
      seo.push('<script type="application/ld+json">' + jsonLD(item) + '</script>');
    }
    return '<!doctype html>\n<html lang="zh-CN">\n<head>\n' +
      '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      seo.join('\n') + '\n' +
      '<link rel="icon" type="image/svg+xml" href="' + esc(prefix) + 'favicon.svg">\n' +
      '<link rel="stylesheet" href="' + esc(prefix) + 'style.css">\n' +
      '</head>\n<body>\n<nav aria-label="网站导航">' + navigation(prefix, current, categories) +
      '</nav>\n<hr>\n<main>\n' + body + '\n</main>\n<footer class="site-footer">联系方式：<a href="mailto:y1830959054@gmail.com">y1830959054@gmail.com</a></footer>\n</body>\n</html>\n';
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
      title: SITE_NAME, description: SITE_DESCRIPTION,
      body: itemList(articles, '', lookup), location: 'index.html',
      current: 'home', categories, baseURL: BASE_URL,
      ld: [
        { '@type': 'WebSite', '@id': BASE_URL + '#website', url: BASE_URL,
          name: SITE_NAME, description: SITE_DESCRIPTION, inLanguage: 'zh-CN' },
        { '@type': 'Blog', '@id': BASE_URL + '#blog', url: BASE_URL,
          name: SITE_NAME, description: SITE_DESCRIPTION,
          author: { '@type': 'Person', name: AUTHOR }, inLanguage: 'zh-CN' }
      ]
    })));
    for (const category of categories) {
      const slug = CATEGORY_SLUGS[category.id];
      const subset = articles.filter(a => a.category_id === category.id);
      const location = 'categories/' + slug + '/index.html';
      outputFiles.push(output(location, page({
        title: category.name,
        description: SITE_NAME + '收录的' + category.name + '文章，共' + subset.length + '篇。' +
          (subset.length ? '包括' + subset.slice(0, 3).map(a => a.title).join('、') + '等。' : ''),
        body: '<h1>' + esc(category.name) + '</h1>' + itemList(subset, '../../', lookup, false),
        location, current: slug, categories, baseURL: BASE_URL,
        ld: [
          { '@type': 'CollectionPage', name: category.name + ' | ' + SITE_NAME,
            url: fullURL(BASE_URL, 'categories/' + slug + '/'), inLanguage: 'zh-CN' },
          breadcrumbs([[SITE_NAME, BASE_URL], [category.name, fullURL(BASE_URL, 'categories/' + slug + '/')]])
        ]
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
      title: '文章归档', description: '按年份浏览' + SITE_NAME + '的全部' + articles.length +
        '篇技术文章，涉及 Go、PHP、Flutter、前端与系统开发。',
      body: archive.join('\n'), location: 'archive/index.html', current: 'archive',
      categories, baseURL: BASE_URL,
      ld: [
        { '@type': 'CollectionPage', name: '文章归档 | ' + SITE_NAME,
          url: fullURL(BASE_URL, 'archive/'), inLanguage: 'zh-CN' },
        breadcrumbs([[SITE_NAME, BASE_URL], ['文章归档', fullURL(BASE_URL, 'archive/')]])
      ]
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
        title: a.title, description: articleDescription(sourceTexts[i], a.title, category.name), body,
        location, current: '', categories, baseURL: BASE_URL,
        type: 'article', article: a, category
      })));
    }

    const paths = ['', 'archive/']
      .concat(categories.map(c => 'categories/' + CATEGORY_SLUGS[c.id] + '/'))
      .concat(articles.map(a => 'articles/' + a.id + '/'));
    // lastmod only uses publication or explicit edit timestamps, never build time.
    const modified = a => a.updated_at || a.created_at;
    const latest = subset => subset.reduce((last, a) => modified(a) > last ? modified(a) : last, '');
    const dates = new Map([
      ['', latest(articles)],
      ['archive/', latest(articles)],
      ...categories.map(c => [
        'categories/' + CATEGORY_SLUGS[c.id] + '/',
        latest(articles.filter(a => a.category_id === c.id))
      ]),
      ...articles.map(a => ['articles/' + a.id + '/', modified(a)])
    ]);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      paths.map(p => '<url><loc>' + esc(fullURL(BASE_URL, p)) + '</loc>' +
        (dates.get(p) ? '<lastmod>' + esc(dates.get(p)) + '</lastmod>' : '') + '</url>').join('') +
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
    renderMarkdown, buildSite, articleDescription, CATEGORY_SLUGS, BASE_URL, SITE_NAME
  });
})();
