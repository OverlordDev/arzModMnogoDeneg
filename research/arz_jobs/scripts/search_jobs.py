import json, subprocess, pathlib

QUERIES = [
    "аризона рп обзор работы",
    "аризона рп путь бомжа",
    "аризона рп сколько можно заработать",
    "аризона рп фарм виртов",
    "arizona rp работа зарплата",
    "аризона рп лучшая работа",
    "аризона рп заработок новичку",
    "аризона рп тест работ",
]

OUT = pathlib.Path(r'C:\Users\negrozoido\Desktop\arzModMnogoDeneg\research\arz_jobs')
OUT.mkdir(parents=True, exist_ok=True)

seen = {}
for q in QUERIES:
    print("QUERY:", q, flush=True)
    try:
        r = subprocess.run(
            ["yt-dlp", f"ytsearch15:{q}", "--flat-playlist", "--no-warnings", "--ignore-errors",
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
            seen[vid]["queries"].append(q)
            continue
        seen[vid] = {"id": vid, "title": title, "duration": dur, "views": views,
                     "channel": chan, "timestamp": ts, "queries": [q]}
        n += 1
    print(f"  +{n} новых")

with open(OUT / "candidates_raw.json", "w", encoding="utf-8") as f:
    json.dump(list(seen.values()), f, ensure_ascii=False, indent=1)
print("TOTAL unique:", len(seen))
