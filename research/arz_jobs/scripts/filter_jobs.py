import json, datetime as dt, pathlib

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
cands = json.load(open(OUT / "candidates_raw.json", encoding="utf-8"))

CUTOFF = dt.date(2026, 11, 4)  # последние 2 недели от 18.11.2026
rows = []
for c in cands:
    try:
        ts = int(c["timestamp"]) if c["timestamp"] not in (None, "", "None") else 0
    except (ValueError, TypeError):
        ts = 0
    d = dt.date.fromtimestamp(ts) if ts else None
    try:
        dur = int(float(c["duration"] or 0))
    except (ValueError, TypeError):
        dur = 0
    try:
        views = int(c["views"] or 0)
    except (ValueError, TypeError):
        views = 0
    rows.append({**c, "date": str(d) if d else "?", "dur_s": dur, "views_n": views, "ts": ts})

print(f"всего: {len(rows)}")
with_ts = [r for r in rows if r["ts"]]
print(f"с датой: {len(with_ts)}, без даты: {len(rows) - len(with_ts)}")
fresh = [r for r in rows if r["date"] != "?" and r["date"] >= str(CUTOFF)]
print(f"свежие (>=2026-11-04): {len(fresh)}")
for r in sorted(fresh, key=lambda x: -x["views_n"])[:40]:
    print(f"  {r['date']} {r['dur_s']//60:3d}мин {r['views_n']:>9,} | {r['title'][:80]} | {r['channel'][:30]}")
json.dump(rows, open(OUT / "candidates_dated.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
