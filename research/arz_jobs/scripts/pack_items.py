"""Упаковка каталога предметов для терминала: updated-штамп + копия в data/."""
from __future__ import annotations

import datetime as dt
import json
import pathlib

SRC = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs\items_catalog.json')
DST = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\arz-terminal\data\items_catalog.json')

items = json.loads(SRC.read_text(encoding='utf-8'))
doc = {
    "updated": dt.date.today().isoformat(),
    "source": "arz-wiki.com/arz-rp/items (скрапинг листинга, категории — по названиям)",
    "count": len(items),
    "items": [{"name": it.get("name", ""), "url": it.get("url", ""),
               "cat": it.get("cat") or "Прочее", "rarity": it.get("rarity") or ""} for it in items],
}
DST.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
print(f"записано: {len(items)} предметов, {DST.stat().st_size // 1024} КБ")
