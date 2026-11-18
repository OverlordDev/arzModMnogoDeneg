"""Merge per-video notes into one chronological Markdown file."""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_youtube")
selected = json.loads((BASE / "selected.json").read_text(encoding="utf-8"))
selected.sort(key=lambda x: x["date"])

parts = ["# Сводные заметки по видео Arizona RP (2022–2026)\n"]
missing = []
for v in selected:
    note = BASE / "notes" / f"{v['id']}.md"
    parts.append(f"\n---\n\n## {v['date']} — {v['title']}\n\n")
    parts.append(f"[Видео]({v['url']}) · {v['duration'] // 60}:{v['duration'] % 60:02d}\n\n")
    if note.exists():
        body = note.read_text(encoding="utf-8").strip()
        # Drop the duplicated top-level title from the note.
        lines = body.splitlines()
        if lines and lines[0].startswith("# "):
            lines = lines[1:]
        parts.append("\n".join(lines).strip() + "\n")
    else:
        missing.append(v["id"])
        parts.append("_Заметка ещё не готова._\n")

visual = BASE / "notes_visual_supplement.md"
if visual.exists():
    parts.append("\n---\n\n" + visual.read_text(encoding="utf-8").strip() + "\n")

out = BASE / "merged_notes.md"
out.write_text("\n".join(parts), encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size} bytes); missing notes: {len(missing)}")
if missing:
    print("missing:", ", ".join(missing))
