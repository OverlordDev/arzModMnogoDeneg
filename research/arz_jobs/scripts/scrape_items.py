"""Скрапинг каталога предметов arz-wiki (имена, ссылки, категории).

122 страницы листинга -> research/arz_jobs/items_catalog.json
Идём пока страницы не станут пустыми/повторяться. Прогресс сохраняется,
можно перезапускать.
"""
from __future__ import annotations

import json
import pathlib
import re
import time
import urllib.request

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs\items_catalog.json')
TMP = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs\items_catalog.partial.json')

HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def fetch(url: str, tries: int = 3) -> str | None:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HDR)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"  retry {i + 1}: {e}")
            time.sleep(2 + i * 2)
    return None


def parse(html: str) -> list[dict]:
    items = []
    # карточка: <a class="card card--item ..." href="URL" title="Название" ... data-ic="Редкость">...<span>Имя</span>...<div class="card__category">Кат</div>...</a>
    for m in re.finditer(r'<a class="card card--item\b([^>]*)>(.*?)</a>', html, re.S):
        head, inner = m.group(1), m.group(2)
        um = re.search(r'href="(https://arz-wiki\.com/arz-rp/items/[^"]+/)"', head)
        if not um:
            continue
        url = um.group(1)
        tm = re.search(r'title="([^"]*)"', head)
        name = (tm.group(1) if tm else "").strip()
        if not name:
            sm = re.search(r'<span>(.*?)</span>', inner, re.S)
            if sm:
                name = re.sub(r"\s+", " ", sm.group(1)).strip()
        rm = re.search(r'data-ic="([^"]*)"', head)
        rarity = (rm.group(1) if rm else "").strip()
        cat = ""
        cm = re.search(r'<div class="card__category">(.*?)</div>', inner, re.S)
        if cm:
            cat = re.sub(r"<[^>]+>", "", cm.group(1))
            cat = re.sub(r"\s+", " ", cat).strip()
        if name and len(name) > 1:
            items.append({"name": name, "url": url, "cat": cat, "rarity": rarity})
    # дедуп по url с сохранением порядка
    seen, out = set(), []
    for it in items:
        if it["url"] not in seen:
            seen.add(it["url"])
            out.append(it)
    return out


def main() -> int:
    done: dict[str, dict] = {}
    if TMP.exists():
        try:
            for it in json.loads(TMP.read_text(encoding="utf-8")):
                done[it["url"]] = it
            print(f"продолжаю, уже есть: {len(done)}")
        except json.JSONDecodeError:
            pass
    page, empty_streak = 1, 0
    while True:
        url = "https://arz-wiki.com/arz-rp/items/" if page == 1 else f"https://arz-wiki.com/arz-rp/items/?paged={page}"
        print(f"стр. {page}...", flush=True)
        html = fetch(url)
        if not html:
            empty_streak += 1
            if empty_streak >= 3:
                break
            page += 1
            continue
        items = parse(html)
        new = sum(1 for it in items if it["url"] not in done)
        for it in items:
            done.setdefault(it["url"], it)
        print(f"  позиций: {len(items)}, новых: {new}, всего: {len(done)}")
        TMP.write_text(json.dumps(list(done.values()), ensure_ascii=False), encoding="utf-8")
        if not items or (new == 0 and page > 5):
            empty_streak += 1
            if empty_streak >= 2:
                break
        else:
            empty_streak = 0
        page += 1
        if page > 130:
            break
        time.sleep(0.4)
    OUT.write_text(json.dumps(list(done.values()), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"ГОТОВО: {len(done)} предметов -> {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
