const $ = (id) => document.getElementById(id);
const elements = {
  count: $('article-count'), list: $('articles'), search: $('search'),
  title: $('title'), category: $('category'), body: $('body'),
  id: $('article-id'), date: $('date-info'), status: $('status'),
  save: $('save-btn'), publish: $('publish-btn'), create: $('new-btn'),
  editTab: $('edit-tab'), previewTab: $('preview-tab'), preview: $('preview'),
};
let articles = [];
let categories = [];
let currentId = null;
let dirty = false;
let busy = false;
let mode = 'edit';
let previewSequence = 0;

async function api(route, options = {}) {
  const result = await fetch(route, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.error || '请求失败（' + result.status + '）');
  return data;
}
function status(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = type;
}
function setBusy(on) {
  busy = on;
  [elements.save, elements.publish, elements.create].forEach(node => node.disabled = on);
}
function markDirty() {
  dirty = true;
  status('有尚未保存的修改');
}
function confirmLoseDraft() {
  return !dirty || window.confirm('这篇文章还有未保存的修改，确定要放弃吗？');
}
function localDate(a) {
  return a ? a.created_at.slice(0, 10) : '';
}
function renderArticleList() {
  const filter = elements.search.value.trim().toLocaleLowerCase();
  const matching = articles.filter(a => a.title.toLocaleLowerCase().includes(filter));
  elements.count.textContent = String(articles.length);
  elements.list.replaceChildren();
  if (!matching.length) {
    const p = document.createElement('p');
    p.className = 'no-results';
    p.textContent = '没有匹配的文章';
    elements.list.appendChild(p);
    return;
  }
  const names = new Map(categories.map(c => [c.id, c.name]));
  for (const a of matching) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'article-row' + (a.id === currentId ? ' active' : '');
    const title = document.createElement('strong');
    title.textContent = a.title;
    const info = document.createElement('span');
    info.textContent = localDate(a) + ' · ' + (names.get(a.category_id) || '');
    btn.append(title, info);
    btn.addEventListener('click', () => openArticle(a.id));
    elements.list.appendChild(btn);
  }
}
function showArticle(a, body) {
  currentId = a?.id ?? null;
  elements.title.value = a?.title || '';
  elements.category.value = String(a?.category_id ?? categories[0]?.id ?? '');
  elements.body.value = body || '';
  elements.id.textContent = currentId ? '文章 #' + currentId : '未保存的新文章';
  elements.date.textContent = a?.created_at ? localDate(a) : '';
  dirty = false;
  status(currentId ? '文章已载入' : '可以开始写新文章');
  renderArticleList();
  if (mode === 'preview') void refreshPreview();
}
function newArticle() {
  if (busy || !confirmLoseDraft()) return;
  showArticle(null, '# ');
  elements.title.focus();
}
async function openArticle(id) {
  if (busy || id === currentId || !confirmLoseDraft()) return;
  try {
    const article = await api('/api/articles/' + id);
    showArticle(article, article.body);
  } catch (err) { status(err.message, 'error'); }
}
async function reloadList() {
  const data = await api('/api/articles');
  categories = data.categories;
  articles = data.articles;
  $('open-site').href = data.site;
  elements.category.replaceChildren();
  for (const c of categories) {
    const option = document.createElement('option');
    option.value = String(c.id);
    option.textContent = c.name;
    elements.category.appendChild(option);
  }
  renderArticleList();
}
async function save() {
  if (busy) return null;
  setBusy(true);
  status('正在保存…');
  try {
    const payload = {
      id: currentId,
      title: elements.title.value,
      category_id: Number(elements.category.value),
      body: elements.body.value,
    };
    const saved = await api('/api/save', { method: 'POST', body: JSON.stringify(payload) });
    currentId = saved.id;
    dirty = false;
    elements.id.textContent = '文章 #' + saved.id;
    elements.date.textContent = localDate(saved);
    await reloadList();
    status('已保存到 content/posts/' + saved.id + '.md', 'success');
    return saved;
  } catch (err) {
    status(err.message, 'error');
    return null;
  } finally { setBusy(false); }
}
async function publish() {
  if (busy) return;
  if (dirty || currentId === null) {
    const saved = await save();
    if (!saved) return;
  }
  if (!window.confirm('将生成全部静态页面、提交并推送到 GitHub main 分支。确定发布吗？')) return;
  setBusy(true);
  status('正在生成、校验并推送 GitHub…');
  try {
    const result = await api('/api/publish', { method: 'POST', body: '{}' });
    status(result.message + (result.commit ? ' · ' + result.commit : ''), 'success');
  } catch (err) {
    status(err.message, 'error');
  } finally { setBusy(false); }
}
async function refreshPreview() {
  if (mode !== 'preview') return;
  const sequence = ++previewSequence;
  try {
    const data = await api('/api/preview', {
      method: 'POST', body: JSON.stringify({ title: elements.title.value, body: elements.body.value }),
    });
    if (sequence !== previewSequence) return;
    // An isolated, script-disabled frame prevents embedded article HTML from
    // executing in the privileged local editor origin.
    elements.preview.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body { font: 15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",Arial,sans-serif; color:#242424; margin:20px 0; overflow-wrap:anywhere; }
        h1,h2,h3 { line-height:1.3 } h1 {font-size:26px} h2 {font-size:21px} h3 {font-size:18px}
        a {color:#0000bb} pre {padding:12px;background:#f6f6f6;overflow-x:auto;border:1px solid #e4e4e4}
        pre,code {font-family:Consolas,Monaco,monospace} code {overflow-wrap:anywhere}
        img {max-width:100%} table {border-collapse:collapse;display:block;overflow:auto}
        td,th {border:1px solid #ddd;padding:6px} blockquote {color:#666;border-left:3px solid #ddd;padding-left:12px;margin-left:0}
      </style></head><body>${data.html}</body></html>`;
  } catch (err) { status('预览失败：' + err.message, 'error'); }
}
function switchMode(next) {
  mode = next;
  const preview = next === 'preview';
  elements.body.hidden = preview;
  elements.preview.hidden = !preview;
  elements.previewTab.classList.toggle('active', preview);
  elements.editTab.classList.toggle('active', !preview);
  elements.previewTab.setAttribute('aria-selected', String(preview));
  elements.editTab.setAttribute('aria-selected', String(!preview));
  if (preview) void refreshPreview();
}
elements.create.addEventListener('click', newArticle);
elements.save.addEventListener('click', save);
elements.publish.addEventListener('click', publish);
elements.search.addEventListener('input', renderArticleList);
elements.editTab.addEventListener('click', () => switchMode('edit'));
elements.previewTab.addEventListener('click', () => switchMode('preview'));
[elements.title, elements.category, elements.body].forEach(el => el.addEventListener('input', markDirty));
window.addEventListener('beforeunload', (event) => {
  if (dirty) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
  }
});
try {
  await reloadList();
  if (articles.length) {
    // Start with a blank article rather than editing the newest post accidentally.
    showArticle(null, '');
  }
} catch (err) {
  status('无法加载文章：' + err.message, 'error');
}
