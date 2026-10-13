import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, readContent, renderMarkdown, ROOT } from './build_site.mjs';
import { verifySite } from './verify_site.mjs';

const PORT = Number(process.env.BLOG_PORT || 4173);
const ADDRESS = '127.0.0.1';
const EDITOR_DIR = path.join(ROOT, 'publisher');
const MAX_BYTES = 2 * 1024 * 1024;
const BASE = 'https://yinjiaming666.github.io/blog/';
let publishing = false;
const MIME = { '/': 'text/html; charset=utf-8', '/app.css': 'text/css; charset=utf-8',
  '/app.js': 'text/javascript; charset=utf-8' };

function response(res, code, object) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(object));
}
function textFile(res, target, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'" });
  res.end(fs.readFileSync(target));
}
async function parseJSON(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    throw Object.assign(new Error('Request must be application/json'), { status: 415 });
  }
  let received = 0;
  const chunks = [];
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_BYTES) throw Object.assign(new Error('Article too large (max 2 MB)'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
const withStatus = (msg, status = 400) => Object.assign(new Error(msg), { status });
function timestampLocal(ms) {
  const d = new Date(ms);
  const pad = number => String(number).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
const present = a => ({ id: a.id, title: a.title, category_id: a.category_id,
  created_at: a.created_at, unix_time: a.unix_time });
function list() {
  const data = readContent();
  return { categories: data.categories,
    articles: [...data.articles].sort((a, b) => b.unix_time - a.unix_time || b.id - a.id).map(present),
    site: BASE };
}
function article(id) {
  const data = readContent();
  const selected = data.articles.find(a => a.id === id);
  if (!selected) throw withStatus('Article not found', 404);
  const contentPath = path.join(ROOT, 'content', 'posts', id + '.md');
  return { ...present(selected), body: fs.readFileSync(contentPath, 'utf8') };
}
function saveArticle(input) {
  if (publishing) throw withStatus('Publishing in progress. Try again shortly.', 409);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body : '';
  const categoryId = Number(input.category_id);
  const data = readContent();
  if (!title || title.length > 250) throw withStatus('请输入不超过 250 字的文章标题');
  if (!body.trim()) throw withStatus('文章内容不能为空');
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw withStatus('正文超过 2 MB');
  if (!data.categories.some(c => c.id === categoryId)) throw withStatus('请选择有效的分类');

  const providedID = input.id == null ? null : Number(input.id);
  if (providedID !== null && (!Number.isSafeInteger(providedID) || providedID <= 0)) throw withStatus('Invalid article ID');
  const previous = providedID !== null ? data.articles.find(a => a.id === providedID) : null;
  if (providedID !== null && !previous) throw withStatus('Article not found', 404);

  const id = previous ? previous.id : Math.max(0, ...data.articles.map(a => a.id)) + 1;
  const now = Date.now();
  const record = previous ?
    { ...previous, title, category_id: categoryId } :
    { id, title, category_id: categoryId, created_at: timestampLocal(now),
      unix_time: Math.floor(now / 1000), source: `content/posts/${id}.md`, original_format: 'markdown' };
  const postFile = path.join(ROOT, 'content', 'posts', `${id}.md`);
  const metaFile = path.join(ROOT, 'content', 'articles.json');
  const previousBody = fs.existsSync(postFile) ? fs.readFileSync(postFile, 'utf8') : null;
  const oldMetadata = fs.readFileSync(metaFile, 'utf8');
  if (previous) Object.assign(previous, record);
  else data.articles.push(record);
  data.articles.sort((a, b) => b.unix_time - a.unix_time || b.id - a.id);
  try {
    fs.writeFileSync(postFile, body, 'utf8');
    const temp = metaFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, metaFile);
  } catch (err) {
    if (previousBody === null) fs.rmSync(postFile, { force: true });
    else fs.writeFileSync(postFile, previousBody, 'utf8');
    fs.writeFileSync(metaFile, oldMetadata, 'utf8');
    throw err;
  }
  return { ...present(record), body, url: BASE + `articles/${id}/` };
}
function git(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 3 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const msg = (result.stderr || result.stdout || result.error?.message || 'git failed').trim();
    throw new Error(`git ${args[0]} 失败: ${msg}`);
  }
  return result.stdout.trim();
}
function publish() {
  if (publishing) throw withStatus('已有发布任务进行中', 409);
  publishing = true;
  try {
    if (git('branch', '--show-current') !== 'main') throw new Error('当前不在 main 分支，已取消推送');
    // Never include existing staged changes, to avoid publishing unrelated local work.
    const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
    if (staged.status !== 0) throw new Error('暂存区已有修改，请先处理现有 git add 的文件');
    const stats = buildSite();
    verifySite();
    git('add', '-A', '--', 'content', 'index.html', 'articles', 'categories', 'archive',
      'style.css', 'sitemap.xml', 'robots.txt', '.nojekyll');
    const changes = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
    if (changes.status === 0) return { ok: true, changed: false, message: '无新增修改，网站已是最新版本', ...stats };
    if (changes.status !== 1) throw new Error('无法读取 Git 暂存区');
    git('commit', '-m', 'Publish blog articles');
    const sha = git('rev-parse', '--short', 'HEAD');
    try { git('push', 'origin', 'main'); }
    catch (err) {
      throw new Error(`${err.message}。本地提交 ${sha} 已保留，可手动执行 git push origin main`);
    }
    return { ok: true, changed: true, commit: sha, message: '已推送 GitHub，等待 Pages 部署', ...stats };
  } finally { publishing = false; }
}

const server = http.createServer(async (req, res) => {
  try {
    const hostname = req.headers.host || '';
    if (![ `127.0.0.1:${PORT}`, `localhost:${PORT}` ].includes(hostname)) {
      response(res, 403, { error: 'Invalid Host' }); return;
    }
    const origin = req.headers.origin;
    if (origin && ![`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(origin)) {
      response(res, 403, { error: 'Origin not allowed' }); return;
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && ['/','/app.css','/app.js'].includes(pathname)) {
      const target = pathname === '/' ? 'index.html' : pathname.slice(1);
      textFile(res, path.join(EDITOR_DIR, target), MIME[pathname]); return;
    }
    if (req.method === 'GET' && pathname === '/api/articles') {
      response(res, 200, list()); return;
    }
    if (req.method === 'GET' && /^\/api\/articles\/\d+$/.test(pathname)) {
      response(res, 200, article(Number(pathname.split('/').pop()))); return;
    }
    if (req.method === 'POST' && pathname === '/api/save') {
      response(res, 200, saveArticle(await parseJSON(req))); return;
    }
    if (req.method === 'POST' && pathname === '/api/preview') {
      const payload = await parseJSON(req);
      if (typeof payload.body !== 'string' || payload.body.length > MAX_BYTES) throw withStatus('预览正文格式不正确');
      response(res, 200, { html: renderMarkdown(payload.body, typeof payload.title === 'string' ? payload.title : '') }); return;
    }
    if (req.method === 'POST' && pathname === '/api/publish') {
      await parseJSON(req);
      response(res, 200, publish()); return;
    }
    response(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    response(res, err.status || 500, { error: err.message || 'Internal error' });
  }
});
server.listen(PORT, ADDRESS, () => {
  console.log(`\n博客发布工具： http://${ADDRESS}:${PORT}/`);
  console.log('仅监听本机。关闭窗口或 Ctrl+C 即停止。\n');
});
