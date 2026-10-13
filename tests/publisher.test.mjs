import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { buildSite, readContent, renderMarkdown, ROOT } from '../scripts/build_site.mjs';
import { verifySite } from '../scripts/verify_site.mjs';

test('generated site retains all public articles and categories', () => {
  const content = readContent();
  assert.equal(content.categories.length, 4);
  assert.ok(content.articles.length >= 81);
  assert.equal(content.articles.filter(a => !fs.existsSync(path.join(ROOT, a.source))).length, 0);
  assert.equal(verifySite().articles, content.articles.length);
});

test('Markdown rendering supports code and does not duplicate an initial article title', () => {
  const html = renderMarkdown('# 测试文章\n\n\`\`\`go\nfmt.Println("hello")\n\`\`\`', '测试文章');
  assert.doesNotMatch(html, /<h1>/);
  assert.match(html, /<pre>/);
  assert.match(html, /fmt\.Println/);
});

test('local editor rejects external origins and serves article metadata', async (t) => {
  const port = 41000 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/publisher-server.mjs'], {
    cwd: ROOT, env: { ...process.env, BLOG_PORT: String(port) }, stdio: 'ignore',
  });
  t.after(() => server.kill());
  let running = false;
  for (let i = 0; i < 30; i++) {
    if (server.exitCode !== null) break;
    try { if ((await fetch(url + '/api/articles')).ok) { running = true; break; } }
    catch { await delay(100); }
  }
  assert.ok(running, 'Local editor should start');
  const meta = await (await fetch(url + '/api/articles')).json();
  assert.equal(meta.categories.length, 4);
  assert.ok(meta.articles.length >= 81);
  const article = await (await fetch(url + '/api/articles/' + meta.articles[0].id)).json();
  assert.ok(article.body);
  const html = await (await fetch(url)).text();
  assert.match(html, /博客发布工具/);
  const rendered = await fetch(url + '/api/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '测试', body: '# 测试\n\n**内容**' }),
  });
  assert.equal(rendered.status, 200);
  assert.match((await rendered.json()).html, /<strong>内容<\/strong>/);
  const forbidden = await fetch(url + '/api/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ title: 'bad', body: 'bad' }),
  });
  assert.equal(forbidden.status, 403);
});

test('new article and edits are saved as Markdown using an isolated working copy', async (t) => {
  const { tmpdir } = await import('node:os');
  const temp = fs.mkdtempSync(path.join(tmpdir(), 'blog-publisher-test-'));
  const port = 41000 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'publisher'), path.join(temp, 'publisher'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'content', 'posts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'content', 'articles.json'), path.join(temp, 'content', 'articles.json'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  const server = spawn(process.execPath, [path.join(temp, 'scripts', 'publisher-server.mjs')], {
    cwd: temp, env: { ...process.env, BLOG_PORT: String(port) }, stdio: 'ignore',
  });
  t.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  let running = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url + '/api/articles')).ok) { running = true; break; } }
    catch { await delay(100); }
  }
  assert.ok(running, 'Editor should start in temporary blog directory');
  const initial = await (await fetch(url + '/api/articles')).json();
  const id = Math.max(...initial.articles.map(a => a.id)) + 1;
  const post = async (payload) => {
    const result = await fetch(url + '/api/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(result.status, 200);
    return result.json();
  };
  const created = await post({ title: '测试新文章', category_id: 3, body: '# 测试新文章\n\n正文。' });
  assert.equal(created.id, id);
  assert.equal(fs.readFileSync(path.join(temp, 'content', 'posts', id + '.md'), 'utf8'), '# 测试新文章\n\n正文。');
  const edited = await post({ id, title: '修改后的标题', category_id: 2, body: '修改后的正文。' });
  assert.equal(edited.id, id);
  assert.equal((await (await fetch(url + '/api/articles/' + id)).json()).body, '修改后的正文。');
  const after = JSON.parse(fs.readFileSync(path.join(temp, 'content', 'articles.json'), 'utf8'));
  assert.equal(after.articles.length, initial.articles.length + 1);
  assert.equal(after.articles.find(a => a.id === id).category_id, 2);
  const empty = await fetch(url + '/api/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '', category_id: 2, body: 'test' }),
  });
  assert.equal(empty.status, 400);
});

test('publish builds and pushes to an isolated local Git remote', async (t) => {
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const tempRoot = fs.mkdtempSync(path.join(tmpdir(), 'blog-publish-git-'));
  const working = path.join(tempRoot, 'blog');
  const remote = path.join(tempRoot, 'remote.git');
  const port = 41000 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  fs.mkdirSync(working);
  for (const folder of ['scripts', 'publisher', 'content']) {
    fs.cpSync(path.join(ROOT, folder), path.join(working, folder), { recursive: true });
  }
  for (const item of ['style.css', 'index.html', '.nojekyll']) {
    fs.copyFileSync(path.join(ROOT, item), path.join(working, item));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(working, 'node_modules'), 'dir');
  const git = (...args) => execFileSync('git', args, { cwd: working, encoding: 'utf8', stdio: 'pipe' }).trim();
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', remote]);
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.name', 'Publisher Test');
  git('config', 'user.email', 'publisher-test@example.com');
  git('remote', 'add', 'origin', remote);
  git('add', '-A');
  git('commit', '-qm', 'Initial test commit');
  git('push', 'origin', 'main');
  const firstCommit = git('rev-parse', 'HEAD');
  const server = spawn(process.execPath, [path.join(working, 'scripts', 'publisher-server.mjs')], {
    cwd: working, env: { ...process.env, BLOG_PORT: String(port) }, stdio: 'ignore',
  });
  t.after(() => { server.kill(); fs.rmSync(tempRoot, { recursive: true, force: true }); });
  let running = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url + '/api/articles')).ok) { running = true; break; } }
    catch { await delay(100); }
  }
  assert.ok(running, 'Local publisher should start');
  const save = await fetch(url + '/api/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '发布流程测试', category_id: 1, body: '# 发布流程测试\n\n内容' }),
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  const request = await fetch(url + '/api/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const result = await request.json();
  assert.equal(request.status, 200, JSON.stringify(result));
  assert.ok(result.changed);
  assert.equal(git('status', '--porcelain'), '');
  assert.notEqual(firstCommit, git('rev-parse', 'HEAD'));
  const remoteCommit = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  assert.equal(remoteCommit, git('rev-parse', 'HEAD'));
  assert.ok(fs.existsSync(path.join(working, 'articles', String(saved.id), 'index.html')));
});
