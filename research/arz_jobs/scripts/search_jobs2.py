import json, subprocess, pathlib

QUERIES = [
    "аризона рп лесопилка заработок",
    "аризона рп шахта заработок",
    "аризона рп ферма заработок",
    "аризона рп рыбалка заработок",
    "аризона рп дальнобойщик заработок",
    "аризона рп пилот заработок",
    "аризона рп автобус механик мусорщик",
    "аризона рп нефтевышки заработок",
    "аризона рп ремонт дорог работа",
    "аризона рп развозчик продуктов металловозчик",
]

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
seen = {c["id"]: c for c in json.load(open(OUT / "candidates_raw.json", encoding="utf-8"))}

for q in QUERIES:
    print("QUERY:", q, flush=True)
    try:
        r = subprocess.run(
            ["yt-dlp", f"ytsearch8:{q}", "--flat-playlist", "--no-warnings", "--ignore-errors",
             "--print", "%(id)s\t%(title)s\t%(duration)s\t%(view_count)s\t%(channel)s\t%(timestamp)s"],
            capture_output=True, text=True, timeout=300)
    except Exception as e:
        print("  ERR", e)
        continue
    n = 0
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 6 or not parts[0] or len(parts[0]) != 11:
            continue
        vid, title, dur, views, chan, ts = parts
        if vid in seen:
            if q not in seen[vid]["queries"]:
                seen[vid]["queries"].append(q)
            continue
        seen[vid] = {"id": vid, "title": title, "duration": dur, "views": views,
                     "channel": chan, "timestamp": ts, "queries": [q]}
        n += 1
    print(f"  +{n} новых")

json.dump(list(seen.values()), open(OUT / "candidates_raw.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("TOTAL unique:", len(seen))
