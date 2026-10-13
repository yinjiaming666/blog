#!/usr/bin/env python3
"""Convert visible articles and categories from a Navicat SQL dump into Markdown files.

Only b_article and b_cate are read. The SQL is never executed.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from markdownify import markdownify

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"
LOCAL_TZ = timezone(timedelta(hours=8))


def sql_values(statement: str) -> list:
    marker = " VALUES ("
    position = statement.find(marker)
    if position < 0:
        raise ValueError("SQL INSERT missing VALUES")
    s = statement[position + len(marker):]
    i, values = 0, []
    escaped = {
        "0": "\0", "b": "\b", "n": "\n", "r": "\r",
        "t": "\t", "Z": chr(26), "\\": "\\", "'": "'", '"': '"'
    }
    while i < len(s):
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s):
            raise ValueError("Unterminated SQL INSERT")
        if s[i] == "'":
            i += 1
            chars = []
            while i < len(s):
                c = s[i]
                if c == "\\" and i + 1 < len(s):
                    i += 1
                    chars.append(escaped.get(s[i], s[i]))
                    i += 1
                elif c == "'":
                    if i + 1 < len(s) and s[i + 1] == "'":
                        chars.append("'")
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    chars.append(c)
                    i += 1
            else:
                raise ValueError("Unterminated SQL string")
            values.append("".join(chars))
        else:
            start = i
            while i < len(s) and s[i] not in ",)":
                i += 1
            token = s[start:i].strip()
            values.append(None if token.upper() == "NULL" else int(token))
        while i < len(s) and s[i].isspace():
            i += 1
        if s[i:i + 1] == ")":
            return values
        if s[i:i + 1] != ",":
            raise ValueError("Expected ',' in SQL INSERT")
        i += 1
    raise ValueError("Unterminated SQL INSERT")


def code_language(node):
    classes = " ".join(node.get("class", []))
    found = re.search(r"brush\s*:\s*([a-zA-Z0-9_+-]+)", classes)
    return found.group(1).lower() if found else "text"


def html_to_markdown(html: str) -> str:
    md = markdownify(
        html, heading_style="ATX", bullets="-", code_language_callback=code_language,
        escape_asterisks=False, escape_underscores=False,
    )
    # Keep original formatting and code block whitespace, remove only outer blank lines.
    # Rich-text editors commonly use non-breaking spaces; normalize for code copying.
    return md.replace("\u00a0", " ").strip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sql", type=Path, help="Path to blog.sql (outside the public repo)")
    args = parser.parse_args()
    dump = args.sql.read_text(encoding="utf-8-sig")
    categories = {}
    rows = []
    for line in dump.splitlines():
        if line.startswith("INSERT INTO `b_cate` "):
            row = sql_values(line)
            if len(row) != 4:
                raise ValueError("Unexpected b_cate columns")
            cid, title, deleted, _image = row
            if int(deleted) == 0:
                categories[int(cid)] = str(title)
        elif line.startswith("INSERT INTO `b_article` "):
            row = sql_values(line)
            if len(row) != 10:
                raise ValueError(f"Unexpected b_article columns: {len(row)}")
            rows.append(row)

    if not categories or not rows:
        raise SystemExit("No article/category records found in SQL")

    POSTS.mkdir(parents=True, exist_ok=True)
    # Remove only previously generated article files, so import can be rerun safely.
    for previous in POSTS.iterdir():
        if re.fullmatch(r"\d+\.(?:md|html)", previous.name):
            previous.unlink()

    articles, excluded = [], []
    for row in rows:
        article_id, _uid, title, body, ts, status, deleted, cid, views, type_id = row
        article_id = int(article_id)
        if int(status) != 0 or int(deleted) != 0 or not str(title).strip():
            excluded.append(article_id)
            continue
        if int(cid) not in categories:
            raise ValueError(f"Article {article_id}: missing category {cid}")
        if int(type_id) not in (0, 1):
            raise ValueError(f"Article {article_id}: unexpected type {type_id}")

        markdown = str(body).strip() + "\n" if int(type_id) == 1 else html_to_markdown(str(body))
        (POSTS / f"{article_id}.md").write_text(markdown, encoding="utf-8")
        articles.append({
            "id": article_id,
            "title": str(title),
            "category_id": int(cid),
            "created_at": datetime.fromtimestamp(int(ts), LOCAL_TZ).isoformat(),
            "unix_time": int(ts),
            "source": f"content/posts/{article_id}.md",
            "original_format": "markdown" if int(type_id) == 1 else "html",
        })

    articles.sort(key=lambda a: (-a["unix_time"], -a["id"]))
    data = {"categories": [{"id": k, "name": v} for k, v in sorted(categories.items())],
            "articles": articles}
    (ROOT / "content" / "articles.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    category_counts = Counter(a["category_id"] for a in articles)
    formats = Counter(a["original_format"] for a in articles)
    print(f"Total: {len(rows)}; published: {len(articles)}; excluded: {len(excluded)}")
    print("Categories:", {categories[k]: category_counts[k] for k in sorted(categories)})
    print("Imported source formats:", dict(formats))
    print("Excluded article IDs:", excluded)


if __name__ == "__main__":
    main()
