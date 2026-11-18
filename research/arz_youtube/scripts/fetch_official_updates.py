"""Download official Arizona RP update changelogs from help.arizona-rp.com.

The site is protected by a JS anti-DDoS cookie. The cookie is computed by
solving a small AES-CBC challenge once; afterwards plain HTTP requests work.
Article bodies live in <div id="cw-article-content">.
"""
from __future__ import annotations

import html
import re
import subprocess
import time
from html.parser import HTMLParser
from pathlib import Path

BASE = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\web\official_updates")
BASE.mkdir(parents=True, exist_ok=True)
COOKIE = "R3ACTLAB-ARZ=445ae6147bd20ad4093d80a3558c875c"
HOST = "https://help.arizona-rp.com"

ARTICLE_PATHS = [
    "/hc/arizona-rp/articles/1793490817-halloween_2026",
    "/hc/arizona-rp/articles/1790799614-october_street",
    "/hc/arizona-rp/articles/1787767391-craft",
    "/hc/arizona-rp/articles/1786427965-double_gang",
    "/hc/arizona-rp/articles/1786428603-double_gang2",
    "/hc/arizona-rp/articles/1783468350-thankyou_08072026",
    "/hc/arizona-rp/articles/1780013059-arizona_re_start",
    "/hc/arizona-rp/articles/1775936267-new_arizona",
    "/hc/arizona-rp/articles/1775953436-new_arizona_part2",
    "/hc/arizona-rp/articles/1769605879-code26_battlepass_update",
    "/hc/arizona-rp/articles/1767717703-newyear_2026_event_update",
    "/hc/arizona-rp/articles/1764477807-halloween_2025_event_update",
    "/hc/arizona-rp/articles/1762103677-halloween_2025_update",
    "/hc/arizona-rp/articles/1762111495-halloween_2025_update2",
    "/hc/arizona-rp/articles/1757020233-05092025_autumn_calendar_update",
    "/hc/arizona-rp/articles/1756038339-11_years_update",
    "/hc/arizona-rp/articles/1754034162-ghetto-community-update",
]


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_target = False
        self.depth = 0
        self.skip = 0
        self.title = ""
        self.in_h1 = False
        self.in_h2 = False
        self.in_h3 = False
        self.in_li = False
        self.in_cell = False
        self.parts: list[str] = []
        self.rows: list[list[str]] = []
        self.row: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "div" and a.get("id") == "cw-article-content":
            self.in_target = True
            self.depth = 1
            return
        if not self.in_target:
            if tag == "h1":
                self.in_h1 = True
            return
        if tag in ("script", "style", "iframe"):
            self.skip += 1
        elif tag == "div":
            self.depth += 1
        elif tag == "h1":
            self.in_h1 = True
            self.parts.append("\n\n# ")
        elif tag == "h2":
            self.in_h2 = True
            self.parts.append("\n\n## ")
        elif tag == "h3":
            self.in_h3 = True
            self.parts.append("\n\n### ")
        elif tag == "p":
            self.parts.append("\n\n")
        elif tag == "li":
            self.in_li = True
            self.parts.append("\n- ")
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            self.in_cell = True
            self.row.append("")

    def handle_endtag(self, tag: str) -> None:
        if not self.in_target:
            if tag == "h1":
                self.in_h1 = False
            return
        if tag in ("script", "style", "iframe"):
            if self.skip:
                self.skip -= 1
        elif tag == "div":
            self.depth -= 1
            if self.depth <= 0:
                self.in_target = False
        elif tag == "h1":
            self.in_h1 = False
        elif tag == "h2":
            self.in_h2 = False
        elif tag == "h3":
            self.in_h3 = False
        elif tag == "li":
            self.in_li = False
        elif tag in ("td", "th"):
            self.in_cell = False
        elif tag == "tr":
            if self.row:
                self.parts.append("\n| " + " | ".join(c.strip() for c in self.row) + " |")
                self.row = []

    def handle_data(self, data: str) -> None:
        if not self.in_target or self.skip:
            return
        if self.in_h1 and not self.title:
            self.title += data
        text = re.sub(r"\s+", " ", data)
        if not text.strip():
            return
        if self.in_cell and self.row:
            self.row[-1] += text.strip() + " "
        else:
            self.parts.append(text)

    def text(self) -> str:
        raw = "".join(self.parts)
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


def fix_text(s: str) -> str:
    s = re.sub(r"</?[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def fetch(path: str) -> str:
    # curl works around the TLS/JS challenge where urllib gets the challenge page.
    res = subprocess.run(
        ["curl.exe", "-L", "-s", "--max-time", "60", "-H", f"Cookie: {COOKIE}", HOST + path],
        capture_output=True, check=False,
    )
    return res.stdout.decode("utf-8", errors="replace")


def main() -> None:
    for i, path in enumerate(ARTICLE_PATHS, 1):
        try:
            page = fetch(path)
            p = ArticleParser()
            p.feed(page)
            body = fix_text(p.text())
            meta = re.search(r"Обновлено\s+([A-Za-z]+ \d{1,2}, \d{4})", page)
            updated = meta.group(1) if meta else ""
            tm = re.search(r"<title>(.*?)</title>", page, re.S)
            raw_title = fix_text(tm.group(1)).split("|")[0].strip() if tm else path.rsplit("/", 1)[-1]
            dm = re.search(r"Обновление от (\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)", raw_title)
            if dm:
                date = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}"
                name = dm.group(4).strip()
                title = raw_title
            else:
                date = ""
                name = raw_title
                title = raw_title
            slug = re.sub(r"[^a-zA-Z0-9а-яА-ЯёЁ_-]+", "_", name)[:80].strip("_")
            out = BASE / f"{date or 'no-date'}__{slug}.md"
            header = f"# {title}\n\n- Источник: {HOST + path}\n- Обновлено: {updated}\n\n"
            out.write_text(header + body + "\n", encoding="utf-8")
            print(f"[{i}/{len(ARTICLE_PATHS)}] {out.name}: {len(body)} chars")
        except Exception as e:  # noqa: BLE001
            print(f"[{i}] ERROR {path}: {e}")
        time.sleep(0.4)


if __name__ == "__main__":
    main()
