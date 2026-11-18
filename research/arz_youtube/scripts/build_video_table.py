"""Build Markdown appendix table from selected.json + transcript_index.json."""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_youtube")
selected = json.loads((BASE / "selected.json").read_text(encoding="utf-8"))
idx = {i["id"]: i for i in json.loads((BASE / "transcript_index.json").read_text(encoding="utf-8"))}

lines = ["| № | Дата | Видео | Длит. | Транскрипт |", "|---:|---|---|---:|---|"]
for n, v in enumerate(selected, 1):
    dur = f"{v['duration'] // 60}:{v['duration'] % 60:02d}"
    t = idx.get(v["id"], {})
    words = t.get("words", 0)
    status = f"{words:,} слов ({t.get('lang')})".replace(",", " ") if words else "нет"
    title = v["title"].replace("|", "\\|")
    lines.append(f"| {n} | {v['date']} | [{title}]({v['url']}) | {dur} | {status} |")

(BASE / "appendix_videos.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines[:5]))
print(f"... {len(selected)} rows")
