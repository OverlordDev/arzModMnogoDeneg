import json
from pathlib import Path

base = Path(r"C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_youtube")
raw = (base / "manifest_raw.txt").read_text(encoding="utf-8").splitlines()

exclude = {
    "c8539sQqgqM", "RUMylROCzkE", "SJp7YmOD7zo", "np2HUrh-wG0", "q54eGIwcnok",
    "WR1TPmTO0PQ", "4BKv-iWe028", "Ys1_j51TSgk", "_IbHnG39jUM", "whUjUslDnxI",
    "OYUK5NBUwfk", "6CCGwqQlnBo", "dz-Ek2NB1Y8", "6alxjcyiAt8", "mu1FAUmqxak",
    "LpGVMX3x0zM", "VNoDKdxTD2E", "TjbRvJaWkrc", "QAIIgoOMPZ4", "Wc3MJO1vvhI",
    "CjKHiZ3x7Cg", "8FZh3fRyzyk", "WCtrUFsdJkA", "bEJOYApJamI", "zdo95931poo",
    "geuUc65-vb8", "QAIIgoOMPZ4",
}

items = []
for line in raw:
    parts = line.split("|", 3)
    if len(parts) != 4:
        continue
    vid, date, dur, title = parts
    if vid in exclude:
        continue
    items.append({
        "id": vid,
        "date": f"{date[:4]}-{date[4:6]}-{date[6:]}" if len(date) == 8 else date,
        "duration": int(dur) if dur.isdigit() else 0,
        "title": title,
        "url": f"https://www.youtube.com/watch?v={vid}",
    })

(base / "selected.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
(base / "batch.txt").write_text("\n".join(i["url"] for i in items), encoding="utf-8")
print("selected:", len(items))
for i, it in enumerate(items, 1):
    print(f"{i:2d} {it['date']} {it['duration']//60:3d}:{it['duration']%60:02d} {it['id']} {it['title']}")
