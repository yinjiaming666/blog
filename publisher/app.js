/* Browser-only editor. Reads/writes only the directory explicitly selected by the user. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const ui = {
    folder: $('select-folder'), resume: $('resume-folder'), folderName: $('directory-name'),
    count: $('article-count'), list: $('articles'), search: $('search'),
    title: $('title'), category: $('category'), body: $('body'),
    articleId: $('article-id'), date: $('date-info'), status: $('status'),
    save: $('save-btn'), publish: $('publish-btn'), create: $('new-btn'),
    editTab: $('edit-tab'), previewTab: $('preview-tab'), preview: $('preview')
  };

  let root = null;
  let rememberedHandle = null;
  let articles = [];
  let categories = [];
  let currentId = null;
  let dirty = false;
  let busy = false;
  let mode = 'edit';

  function status(message, type = '') {
    ui.status.textContent = message;
    ui.status.className = type;
  }

  function busyState(on) {
    busy = on;
    ui.folder.disabled = on;
    ui.resume.disabled = on;
    [ui.title, ui.body, ui.category, ui.search, ui.save, ui.publish, ui.create].forEach(el => {
      el.disabled = on || !root;
    });
  }

  function edited() {
    dirty = true;
    status('有尚未保存的修改');
  }

  function confirmDiscard() {
    return !dirty || confirm('当前文章有未保存的内容，确定放弃吗？');
  }

  function sortArticles() {
    articles.sort((a, b) => b.unix_time - a.unix_time || b.id - a.id);
  }

  function refreshArticleList() {
    const query = ui.search.value.trim().toLocaleLowerCase();
    ui.count.textContent = root ? String(articles.length) : '';
    ui.list.replaceChildren();

    const visible = articles.filter(a => a.title.toLocaleLowerCase().includes(query));
    const categoryLabels = new Map(categories.map(c => [c.id, c.name]));
    if (!visible.length && root) {
      const message = document.createElement('p');
      message.className = 'no-results';
      message.textContent = '没有匹配的文章';
      ui.list.appendChild(message);
      return;
    }

    for (const article of visible) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'article-row' + (article.id === currentId ? ' active' : '');
      const heading = document.createElement('strong');
      heading.textContent = article.title;
      const info = document.createElement('span');
      info.textContent = article.created_at.slice(0, 10) + ' · ' +
        (categoryLabels.get(article.category_id) || '');
      row.append(heading, info);
      row.addEventListener('click', () => void openArticle(article.id));
      ui.list.appendChild(row);
    }
  }

  function displayArticle(article, body = '') {
    currentId = article ? article.id : null;
    ui.title.value = article ? article.title : '';
    ui.category.value = String(article ? article.category_id : (categories[0] && categories[0].id));
    ui.body.value = body;
    ui.articleId.textContent = article ? '文章 #' + article.id : '未保存的新文章';
    ui.date.textContent = article ? article.created_at.slice(0, 10) : '';
    dirty = false;
    refreshArticleList();
    status(article ? '文章已载入' : '可以开始写文章');
    if (mode === 'preview') refreshPreview();
  }

  function updateFolderButtons() {
    ui.resume.hidden = !rememberedHandle || Boolean(root);
    ui.folder.textContent = root || rememberedHandle ? '更换目录' : '选择博客目录';
    ui.folderName.textContent = root ? root.name : rememberedHandle ?
      rememberedHandle.name + '（待授权）' : '尚未选择博客目录';
  }

  async function openDirectory(handle, source) {
    const data = await BlogStatic.loadProject(handle);
    root = handle;
    categories = data.categories;
    articles = data.articles;
    sortArticles();
    ui.category.replaceChildren();
    for (const category of categories) {
      const option = document.createElement('option');
      option.value = String(category.id);
      option.textContent = category.name;
      ui.category.appendChild(option);
    }
    ui.search.value = '';
    busyState(false);
    displayArticle(null);
    updateFolderButtons();
    status(source + handle.name + '，共 ' + articles.length + ' 篇文章', 'success');
  }

  async function chooseFolder() {
    if (busy || !confirmDiscard()) return;
    if (typeof window.showDirectoryPicker !== 'function') {
      status('当前浏览器不支持文件夹读写，请用新版 Chrome 或 Edge 打开本页面。', 'error');
      return;
    }
    try {
      // Must run from a user click. Browser authorizes this directory only.
      const selected = await window.showDirectoryPicker({ mode: 'readwrite', id: 'local-blog' });
      await openDirectory(selected, '已打开 ');
      rememberedHandle = selected;
      updateFolderButtons();
      try {
        await BlogFolderStore.set(selected);
      } catch (err) {
        status('目录已打开，但浏览器无法记住目录：' + err.message, 'error');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      status('打开失败：请选择包含 content/articles.json 和 style.css 的博客根目录。' +
        (err && err.message ? ' ' + err.message : ''), 'error');
    }
  }

  async function resumeFolder() {
    if (busy || !rememberedHandle || !confirmDiscard()) return;
    try {
      // requestPermission must be initiated directly by this button click.
      const permission = await rememberedHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        status('浏览器未授予目录权限。请点击“恢复上次目录”重试，或更换目录。', 'error');
        return;
      }
      await openDirectory(rememberedHandle, '已恢复 ');
    } catch (err) {
      status('恢复失败：' + err.message + '。可以点击“更换目录”重新选择。', 'error');
    }
  }

  async function restoreFolderOnStartup() {
    ui.folder.disabled = true;
    status('正在检查上次使用的目录…');
    try {
      const saved = await BlogFolderStore.get();
      if (!saved) {
        status('首次使用，请选择本地 utils/blog 目录。');
        return;
      }
      rememberedHandle = saved;
      updateFolderButtons();
      // Merely checking permission does not trigger a permission prompt.
      const permission = await saved.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        try {
          await openDirectory(saved, '已自动恢复 ');
          return;
        } catch (err) {
          status('上次目录无法读取：' + err.message + '。请恢复授权或更换目录。', 'error');
          return;
        }
      }
      status('已记住 ' + saved.name + '，点击“恢复上次目录”重新授权即可。');
    } catch (err) {
      status('无法读取目录记忆：' + err.message + '。请手动选择博客目录。', 'error');
    } finally {
      ui.folder.disabled = false;
      updateFolderButtons();
    }
  }

  function createArticle() {
    if (busy || !root || !confirmDiscard()) return;
    displayArticle(null);
    ui.title.focus();
  }

  async function openArticle(id) {
    if (busy || !root || id === currentId || !confirmDiscard()) return;
    busyState(true);
    try {
      const article = await BlogStatic.readArticle(root, id);
      displayArticle(article, article.body);
    } catch (err) {
      status('读取文章失败：' + err.message, 'error');
    } finally {
      busyState(false);
    }
  }

  async function saveArticle() {
    if (busy || !root) return false;
    busyState(true);
    status('正在保存本地文章...');
    try {
      const saved = await BlogStatic.saveArticle(root, {
        id: currentId,
        title: ui.title.value,
        category_id: Number(ui.category.value),
        body: ui.body.value
      });
      currentId = saved.id;
      dirty = false;
      const project = await BlogStatic.readMetadata(root);
      articles = project.articles;
      sortArticles();
      ui.articleId.textContent = '文章 #' + saved.id;
      ui.date.textContent = saved.created_at.slice(0, 10);
      refreshArticleList();
      status('已保存 content/posts/' + saved.id + '.md', 'success');
      return true;
    } catch (err) {
      status('保存失败：' + err.message, 'error');
      return false;
    } finally {
      busyState(false);
    }
  }

  async function generateSite() {
    if (busy || !root) return;
    if (dirty) {
      if (!await saveArticle()) return;
    }
    if (!confirm('将重新生成本地博客的所有 HTML 页面，不会提交或推送 GitHub。继续吗？')) return;
    busyState(true);
    status('正在生成 HTML...');
    try {
      const result = await BlogStatic.buildSite(root, (done, total) => {
        status('正在生成 HTML：' + done + ' / ' + total);
      });
      status('生成完成：' + result.articles + ' 篇文章，' + result.pages +
        ' 个 HTML 页面。请自行 git commit 和 git push。', 'success');
    } catch (err) {
      status('生成失败：' + err.message, 'error');
    } finally {
      busyState(false);
    }
  }

  function refreshPreview() {
    if (mode !== 'preview') return;
    try {
      const content = BlogStatic.renderMarkdown(ui.body.value, ui.title.value);
      // sandbox="" explicitly disables scripts, forms and privileged parent access.
      ui.preview.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<style>body{font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",Arial,sans-serif;' +
        'color:#242424;margin:20px 0;overflow-wrap:anywhere}' +
        'h1,h2,h3{line-height:1.35}a{color:#0000bb}pre{padding:12px;background:#f6f6f6;' +
        'overflow:auto;border:1px solid #ddd}pre,code{font-family:Consolas,Monaco,monospace}' +
        'img{max-width:100%}table{border-collapse:collapse;display:block;overflow:auto}' +
        'td,th{border:1px solid #ddd;padding:6px}</style></head><body>' + content + '</body></html>';
    } catch (err) {
      status('预览失败：' + err.message, 'error');
    }
  }

  function switchTab(to) {
    mode = to;
    const preview = mode === 'preview';
    ui.body.hidden = preview;
    ui.preview.hidden = !preview;
    ui.editTab.classList.toggle('active', !preview);
    ui.previewTab.classList.toggle('active', preview);
    ui.editTab.setAttribute('aria-selected', String(!preview));
    ui.previewTab.setAttribute('aria-selected', String(preview));
    if (preview) refreshPreview();
  }

  ui.folder.addEventListener('click', () => void chooseFolder());
  ui.resume.addEventListener('click', () => void resumeFolder());
  ui.create.addEventListener('click', createArticle);
  ui.save.addEventListener('click', () => void saveArticle());
  ui.publish.addEventListener('click', () => void generateSite());
  ui.search.addEventListener('input', refreshArticleList);
  ui.editTab.addEventListener('click', () => switchTab('edit'));
  ui.previewTab.addEventListener('click', () => switchTab('preview'));
  [ui.title, ui.category, ui.body].forEach(el => el.addEventListener('input', edited));
  ui.body.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const start = ui.body.selectionStart;
      ui.body.setRangeText('  ', start, ui.body.selectionEnd, 'end');
      edited();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveArticle();
    }
  });
  busyState(false);
  void restoreFolderOnStartup();
})();
