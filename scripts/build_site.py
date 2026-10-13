#!/usr/bin/env python3
"""Build the Markdown blog as plain HTML for GitHub Pages.

No server, database or client-side JavaScript is required.
The blog is a project Pages site at /blog/ unless --base-url changes it.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

import markdown

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "content" / "articles.json"
CATEGORY_SLUGS = {1: "notes", 2: "php", 3: "go", 4: "frontend"}
DEFAULT_URL = "https://yinjiaming666.github.io/blog/"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def absolute(base_url: str, relative: str) -> str:
    return base_url.rstrip("/") + "/" + relative.lstrip("/")


def relative_prefix(relative_page: str) -> str:
    # relative_page: index.html or articles/42/index.html
    return "../" * (len(Path(relative_page).parts) - 1)


def date(article: dict) -> str:
    return datetime.fromisoformat(article["created_at"]).strftime("%Y-%m-%d")


def navigation(prefix: str, current: str, categories: list[dict]) -> str:
    links = [("首页", prefix + "index.html", current == "home"),
             ("归档", prefix + "archive/index.html", current == "archive")]
    for category in categories:
        slug = CATEGORY_SLUGS[category["id"]]
        links.append((category["name"], prefix + f"categories/{slug}/index.html", slug == current))
    anchors = []
    for label, link, active in links:
        aria = ' aria-current="page"' if active else ""
        anchors.append(f'<a href="{esc(link)}"{aria}>{esc(label)}</a>')
    return " ".join(anchors)


def page(*, title: str, description: str, body: str, location: str,
         current: str, categories: list[dict], base_url: str) -> str:
    prefix = relative_prefix(location)
    canonical = absolute(base_url, "" if location == "index.html" else location.removesuffix("index.html"))
    head = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical)}">
<link rel="stylesheet" href="{esc(prefix)}style.css">
</head>
<body>
<nav aria-label="网站导航">{navigation(prefix, current, categories)}</nav>
<hr>
<main>
{body}
</main>
</body>
</html>
"""
    return head


def item(article: dict, prefix: str, categories: dict[int, dict], show_category=True) -> str:
    link = f"{prefix}articles/{article['id']}/index.html"
    cid = article["category_id"]
    cat = categories[cid]
    category_link = f"{prefix}categories/{CATEGORY_SLUGS[cid]}/index.html"
    category = (f' <span class="post-category">[<a href="{esc(category_link)}">{esc(cat["name"])}</a>]</span>'
                if show_category else "")
    return (
        f'<li><time datetime="{esc(date(article))}">{esc(date(article))}</time>'
        f'<span class="post-entry">'
        f'<a class="article-title" href="{esc(link)}">{esc(article["title"])}</a>'
        f'{category}</span></li>'
    )


def item_list(articles: list[dict], prefix: str, categories: dict[int, dict],
              show_category=True) -> str:
    return '<ul class="post-list">\n' + "\n".join(
        item(article, prefix, categories, show_category) for article in articles
    ) + "\n</ul>"


def markdown_html(source: str, title: str) -> str:
    result = markdown.markdown(
        source, extensions=["fenced_code", "tables", "sane_lists"], output_format="html5"
    )
    # The page template already renders the article title; avoid a duplicate first heading.
    match = re.match(r"^<h1>(.*?)</h1>\s*", result, flags=re.DOTALL)
    if match:
        text = html.unescape(re.sub("<[^>]+>", "", match.group(1))).strip()
        if text.casefold() == title.strip().casefold():
            result = result[match.end():]
    return result


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build(base_url: str) -> None:
    if not base_url.startswith("https://") or not base_url.endswith("/"):
        raise ValueError("Base URL must be an https:// URL ending with '/'")
    data = json.loads(DATA.read_text(encoding="utf-8"))
    categories = data["categories"]
    articles = data["articles"]
    category_lookup = {c["id"]: c for c in categories}

    if len({a["id"] for a in articles}) != len(articles):
        raise ValueError("Duplicate article IDs")
    if any(a["category_id"] not in category_lookup for a in articles):
        raise ValueError("Unrecognized category ID")

    # Generated folders only. Sources under content/ are never deleted.
    for folder in ("articles", "categories", "archive"):
        target = ROOT / folder
        if target.exists():
            shutil.rmtree(target)

    # One uncluttered index: the navigation already provides categories and archive.
    home = item_list(articles, "", category_lookup)
    write("index.html", page(title="文章", description="Go、PHP 与前端开发文章",
                             body=home, location="index.html", current="home",
                             categories=categories, base_url=base_url))

    for category in categories:
        slug = CATEGORY_SLUGS[category["id"]]
        subset = [a for a in articles if a["category_id"] == category["id"]]
        location = f"categories/{slug}/index.html"
        body = (f'<h1>{esc(category["name"])}</h1>'
                f'{item_list(subset, "../../", category_lookup, show_category=False)}')
        write(location, page(title=category["name"], description=f'{category["name"]} 分类文章',
                             body=body, location=location, current=slug,
                             categories=categories, base_url=base_url))

    by_year = defaultdict(list)
    for a in articles:
        by_year[date(a)[:4]].append(a)
    archive = ['<h1>文章归档</h1>']
    for year in sorted(by_year, reverse=True):
        archive.append(f'<h2>{esc(year)}</h2>')
        archive.append(item_list(by_year[year], "../", category_lookup))
    write("archive/index.html",
          page(title="文章归档", description="按年份浏览全部文章",
               body="\n".join(archive), location="archive/index.html", current="archive",
               categories=categories, base_url=base_url))

    for article in articles:
        source_path = ROOT / article["source"]
        if not source_path.is_file() or source_path.suffix != ".md":
            raise ValueError(f"Missing Markdown article source: {source_path}")
        content = source_path.read_text(encoding="utf-8")
        if not content.strip():
            raise ValueError(f"Article source is empty: {source_path}")
        category = category_lookup[article["category_id"]]
        cat_link = f'../../categories/{CATEGORY_SLUGS[category["id"]]}/index.html'
        rendered = markdown_html(content, article["title"])
        heading = (
            f'<h1>{esc(article["title"])}</h1>'
            f'<p class="post-meta"><time datetime="{esc(date(article))}">{esc(date(article))}</time>'
            f' · <a href="{esc(cat_link)}">{esc(category["name"])}</a></p>'
        )
        body = heading + f'<article class="prose">\n{rendered}\n</article>'
        location = f'articles/{article["id"]}/index.html'
        write(location,
              page(title=article["title"], description=f'{article["title"]} - {category["name"]}',
                   body=body, location=location, current="",
                   categories=categories, base_url=base_url))

    # GitHub Pages project-site base URL is part of every canonical sitemap URL.
    pages = ["", "archive/"] + [f'categories/{CATEGORY_SLUGS[c["id"]]}/' for c in categories]
    pages += [f'articles/{article["id"]}/' for article in articles]
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    for location in pages:
        url = ET.SubElement(urlset, "url")
        ET.SubElement(url, "loc").text = absolute(base_url, location)
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n' +
          ET.tostring(urlset, encoding="unicode") + "\n")
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {absolute(base_url, 'sitemap.xml')}\n")
    write(".nojekyll", "")
    print(f"Built {len(articles)} articles + {len(categories)} category pages + home and archive.")
    print("Base URL:", base_url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_URL)
    args = parser.parse_args()
    build(args.base_url)
