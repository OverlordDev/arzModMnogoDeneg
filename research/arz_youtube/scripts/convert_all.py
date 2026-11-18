"""Convert every downloaded VTT into a clean .txt and build a transcript index.

Prefers Russian captions; falls back to English. Writes index.json with word
counts so the work can be split evenly between summarization agents.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BASE = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_youtube")
SUBS = BASE / "subs"
SCRIPT = BASE / "scripts" / "vtt_to_txt.py"

selected = json.loads((BASE / "selected.json").read_text(encoding="utf-8"))
index = []
for item in selected:
    vid = item["id"]
    vtt = None
    for lang in ("ru", "en"):
        candidate = SUBS / f"{vid}.{lang}.vtt"
        if candidate.exists():
            vtt = candidate
            break
    if not vtt:
        index.append({**item, "transcript": None, "words": 0})
        continue
    lang = vtt.stem.split(".")[-1]
    out = SUBS / f"{vid}.{lang}.txt"
    if not out.exists():
        subprocess.run([sys.executable, str(SCRIPT), str(vtt)], check=False, capture_output=True)
    text = out.read_text(encoding="utf-8") if out.exists() else ""
    index.append({**item, "transcript": str(out) if out.exists() else None,
                  "lang": lang,
                  "words": len(text.split())})

(BASE / "transcript_index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
have = [i for i in index if i["words"]]
print(f"transcripts: {len(have)}/{len(index)}, total words: {sum(i['words'] for i in have):,}")
for i in index:
    print(f"{i['date']} {i['words']:6,d}w {i['lang'] if i['transcript'] else '---'} {i['id']} {i['title'][:70]}")
