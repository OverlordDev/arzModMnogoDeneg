"""Конвертация VTT в читаемый текст + индекс по батчам."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BASE = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs")
SUBS = BASE / "subs"
CONVERT = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_youtube\scripts\vtt_to_txt.py")
BATCHES = json.loads((BASE / "batches.json").read_text(encoding="utf-8"))

# E_rest делим на два для баланса нагрузки (идемпотентно)
if "E_rest" in BATCHES:
    e = BATCHES.pop("E_rest")
    BATCHES["E1_tops"] = e[:12]
    BATCHES["E2_bomzh"] = e[12:]
    (BASE / "batches.json").write_text(json.dumps(BATCHES, ensure_ascii=False, indent=1), encoding="utf-8")

idx = {}
for bname, ids in BATCHES.items():
    for vid in ids:
        vtt = None
        for lang in ("ru", "en"):
            c = SUBS / f"{vid}.{lang}.vtt"
            if c.exists():
                vtt = c
                break
        if not vtt:
            idx[vid] = {"batch": bname, "transcript": None, "words": 0}
            continue
        lang = vtt.suffixes[-2].lstrip(".") if len(vtt.suffixes) > 1 else "ru"
        out = SUBS / f"{vid}.{lang}.txt"
        if not out.exists():
            subprocess.run([sys.executable, str(CONVERT), str(vtt)], check=False, capture_output=True)
        text = out.read_text(encoding="utf-8") if out.exists() else ""
        idx[vid] = {"batch": bname, "transcript": str(out) if out.exists() else None, "words": len(text.split())}

(BASE / "transcript_index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")
have = [k for k, v in idx.items() if v["words"]]
print(f"транскрипты: {len(have)}/{len(idx)}, слов: {sum(idx[k]['words'] for k in have):,}")
for bname, ids in BATCHES.items():
    w = sum(idx[v]["words"] for v in ids)
    print(f"  {bname}: {len(ids)} видео, {w:,} слов")
missing = [k for k, v in idx.items() if not v["words"]]
if missing:
    print("БЕЗ транскрипта:", ", ".join(missing))
