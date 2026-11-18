"use strict";
/* ARZ Terminal — история капитала игрока (локально).
 *
 * Точки [t, капитал, деньги, оценка инвентаря] пишутся в JSONL-файл.
 * ЛИЧНЫЕ ДАННЫЕ: файл лежит в arz-terminal/local/ (в .gitignore) и НИКОГДА
 * не должен попадать в data/ — планировщик автоматически пушит data/ в GitHub.
 *
 * Политика записи: не чаще раза в MIN_GAP_MS; если ничего не изменилось —
 * не чаще раза в MAX_GAP_MS. Хранится KEEP_MS, старое вычищается при старте.
 */

const fs = require("fs");
const path = require("path");

const KEEP_MS = 14 * 86400000;
const MIN_GAP_MS = 60 * 1000;
const MAX_GAP_MS = 5 * 60 * 1000;

function createHistory(file, nowFn) {
  const now = nowFn || Date.now;
  let pts = [];

  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line);
        if (Array.isArray(p) && p.length >= 3 && p.every((x) => Number.isFinite(x))) pts.push(p);
      } catch (_) { /* битая строка — пропускаем */ }
    }
  } catch (_) { /* файла ещё нет */ }

  const cutoff = now() - KEEP_MS;
  const kept = pts.filter((p) => p[0] >= cutoff);
  if (kept.length !== pts.length) {
    pts = kept;
    try { fs.writeFileSync(file, pts.map((p) => JSON.stringify(p)).join("\n") + (pts.length ? "\n" : "")); } catch (_) {}
  }

  /** Записать точку, если пора. Возвращает true, если записана. */
  function record(t, capital, money, estimate) {
    const last = pts[pts.length - 1];
    if (last) {
      const gap = t - last[0];
      const same = last[1] === capital && last[2] === money;
      if (gap < MIN_GAP_MS) return false;
      if (same && gap < MAX_GAP_MS) return false;
    }
    const p = [t, capital, money, estimate];
    pts.push(p);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(p) + "\n");
    } catch (_) { /* диск недоступен — работаем из памяти */ }
    return true;
  }

  /** Ряд для графика: последние sinceMs, не больше maxPoints (равномерная выборка + последняя точка). */
  function series(maxPoints, sinceMs) {
    const from = sinceMs ? now() - sinceMs : 0;
    const list = pts.filter((p) => p[0] >= from);
    if (list.length <= maxPoints) return list.slice();
    const step = list.length / maxPoints;
    const out = [];
    for (let i = 0; i < maxPoints - 1; i++) out.push(list[Math.floor(i * step)]);
    out.push(list[list.length - 1]);
    return out;
  }

  return { record, series, size: () => pts.length };
}

module.exports = { createHistory, KEEP_MS, MIN_GAP_MS, MAX_GAP_MS };
