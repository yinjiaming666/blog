# 技术笔记（静态博客）

这是一个无后端、无数据库的静态博客。页面风格参考 [bellard.org](https://bellard.org/) 的简单排版：白底、蓝色链接、文章目录和分类。

**文章正文始终存为 Markdown**（包括从旧数据库 HTML 富文本转换过来的文章），网站则直接发布构建后的 HTML 到 GitHub Pages。

## 目录

- `content/posts/{id}.md`：文章 Markdown（保留旧数据库 ID，避免重名）
- `content/articles.json`：文章标题、日期、分类元数据
- `articles/{id}/index.html`：构建的文章详情页
- `categories/*/index.html`：构建的分类页
- `archive/index.html`：文章归档
- `index.html`：首页
- `style.css`：全站样式
- `scripts/import_sql.py`：一次性从 Navicat SQL 导入 Markdown
- `scripts/build_site.py`：将 Markdown 编译为 HTML

## 本地使用

需要 Python 3.9+：

```bash
cd utils/blog
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 已导入文章，日常编辑 Markdown 后只需重新构建：
.venv/bin/python scripts/build_site.py
python3 -m http.server 8000
```

本地打开 http://localhost:8000/ 查看。

要重新从旧 SQL 导入，先备份已有的 Markdown 修改，然后执行：

```bash
.venv/bin/python scripts/import_sql.py /path/to/blog.sql
.venv/bin/python scripts/build_site.py
```

**注意：重新导入会覆盖 `content/posts/{id}.md` 中与 SQL 同 ID 的文章。**
默认只导入 `status = 0` 且 `delete_time = 0` 的公开文章。忽略删除/隐藏的文章。SQL 本身不要上传到公开仓库。

## 部署到 GitHub Pages

仓库地址：`https://github.com/yinjiaming666/blog`

GitHub 仓库设置：

- Settings → Pages → Source: **Deploy from a branch**
- Branch: **main**，目录 **/(root)**

本仓库是 GitHub Pages 的项目站点；默认地址：
`https://yinjiaming666.github.io/blog/`。

`scripts/build_site.py` 默认的站点 URL 即该地址，并会生成 `sitemap.xml` 和 `robots.txt`。
如果更换自定义域名，可使用：

```bash
.venv/bin/python scripts/build_site.py --base-url https://blog.example.com/
```

`index.html`、`articles/`、`categories/`、`archive/` 和 `style.css` 等文件必须提交到 `main`；GitHub Pages 不需要运行 Python 或 Go。

## 迁移说明

- 原文章 90 条，发布未隐藏/未删除的 81 条。
- 其中 72 条原本是 Markdown，9 条原本是 HTML 富文本，**全部转成了 Markdown**。
- 保留四个分类：随笔、PHP、Go、前端。文章按原创建时间排序。
- 为保留原始文章 ID，详情 URL 为 `/blog/articles/{id}/`。
- 原文章中的外部图片仍引用原链接，若原图床关闭，建议将图片下载到仓库并修改引用。
- 构建完全静态，无依赖第三方前端 CDN、动态 API 或 MySQL。
