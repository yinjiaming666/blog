#!/usr/bin/env python3
"""Verify generated static HTML and article/category links before publishing."""
from __future__ import annotations

import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        for key in ("href", "src"):
            value = attributes.get(key)
            if value:
                self.refs.append(value)


def main() -> None:
    data = json.loads((ROOT / "content/articles.json").read_text(encoding="utf-8"))
    articles, categories = data["articles"], data["categories"]
    assert len(articles) == 81, f"Expected 81 public articles, got {len(articles)}"
    assert len(categories) == 4, f"Expected 4 categories, got {len(categories)}"
    assert len({a["id"] for a in articles}) == len(articles), "Duplicate IDs"

    pages = [ROOT / "index.html", ROOT / "archive/index.html"]
    pages += [ROOT / "articles" / str(a["id"]) / "index.html" for a in articles]
    pages += [ROOT / "categories" / slug / "index.html"
              for slug in ("notes", "php", "go", "frontend")]
    missing, bad_sources = [], []
    for a in articles:
        source = ROOT / a["source"]
        if source.suffix != ".md" or not source.exists() or not source.read_text().strip():
            bad_sources.append(a["id"])
    for page in pages:
        if not page.exists():
            missing.append(str(page.relative_to(ROOT)))
            continue
        raw = page.read_text(encoding="utf-8")
        assert "<!doctype html>" in raw.lower(), f"Invalid HTML: {page}"
        parser = References()
        parser.feed(raw)
        for url in parser.refs:
            parts = urlsplit(url)
            if parts.scheme or parts.netloc or parts.path.startswith("/") or url.startswith("#"):
                continue
            target = (page.parent / unquote(parts.path)).resolve()
            if not target.is_file():
                missing.append(f"{page.relative_to(ROOT)} -> {url}")

    assert not bad_sources, f"Markdown sources missing: {bad_sources}"
    assert not missing, f"Missing HTML or broken internal links: {missing[:20]}"
    print(f"PASS: {len(pages)} HTML pages, {len(articles)} Markdown files, "
          f"{len(categories)} categories, no missing internal links.")


if __name__ == "__main__":
    main()
