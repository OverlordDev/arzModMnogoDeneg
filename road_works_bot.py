"""
Бот для мини-игры «Дорожные работы» (найти плохие участки асфальта).

Запуск:   python road_works_bot.py
  Работает автоматически: как только мини-игра на экране - жмёт трещины.
  F6  - пауза/продолжить
  F7  - выход

Проверка на скриншоте без кликов:
  python road_works_bot.py --test скриншот.png

Зависимости: pip install pillow numpy mss pyautogui keyboard
Координаты рассчитаны для 1920x1080 и масштабируются под твоё разрешение
(игра должна быть в полноэкранном/оконном режиме 16:9 на весь экран).
"""
import sys
import time

import numpy as np

# ---- Геометрия сетки (для 1920x1080) ----
COLS, ROWS = 7, 4
X0, Y0 = 497, 343          # центр левой верхней плитки
DX, DY = 156, 156          # шаг между плитками
HALF = 45                  # половина стороны анализируемой области
BASE_W, BASE_H = 1920, 1080

# ---- Детектор трещин ----
DARK_LEVEL = 45            # пиксель темнее этого = "чёрный"
CRACK_RATIO = 0.14         # норма ~0.076, трещина ~0.205 (на 1920x1080)
CLICK_PAUSE = 0.06         # пауза между кликами
RESCAN_DELAY = 0.25
ZONE_MIN_AREA = 40000      # мин. площадь выделенной области (для 1920x1080)
ZONE_CLICK_PAUSE = 0.35    # пауза между кликами по одной и той же области
# Круг с дугой - это ТАЙМЕР работы ручным катком (19 -> 0), кликать там не нужно.
# Поэтому автоклик по нему выключен. Включи True, только если нужен.
ARC_ENABLED = False
ARC_MIN, ARC_MAX = 100, 1500   # допустимое число белых пикселей дуги
ARC_CLICK_PAUSE = 0.05     # частота кликов, пока видна дуга
IDLE_DELAY = 0.3           # частота проверки, когда игры нет
MIN_TILES = 24             # сколько плиток должно быть похожи на асфальт, чтобы считать, что игра открыта


def tile_centers(w, h):
    sx, sy = w / BASE_W, h / BASE_H
    for r in range(ROWS):
        for c in range(COLS):
            yield r, c, int((X0 + c * DX) * sx), int((Y0 + r * DY) * sy)


def find_cracked(img, verbose=False):
    """img: numpy RGB (H,W,3).
    Возвращает список (row, col, x, y) треснувших плиток, либо None,
    если мини-игра на экране не обнаружена (сетка не похожа на асфальт)."""
    h, w = img.shape[:2]
    sx, sy = w / BASE_W, h / BASE_H
    gray = img.astype(np.float32).mean(axis=2)
    res, looks_like_tile = [], 0
    for r, c, x, y in tile_centers(w, h):
        hx, hy = int(HALF * sx), int(HALF * sy)
        tile = gray[y - hy:y + hy, x - hx:x + hx]
        ratio = float((tile < DARK_LEVEL).mean())
        if 105 < tile.mean() < 130 and 42 < tile.std() < 68:
            looks_like_tile += 1
        if verbose:
            print(f"r{r} c{c} ratio={ratio:.3f}")
        if ratio > CRACK_RATIO:
            res.append((r, c, x, y))
    if looks_like_tile < MIN_TILES:
        return None
    return res


def find_pipe_zone(img):
    """Мини-игра «Ремонт водопроводных труб»: ищет полупрозрачный
    серо-голубой прямоугольник. Возвращает (x, y) центра или None."""
    h, w = img.shape[:2]
    r, g, b = (img[:, :, i].astype(np.int16) for i in range(3))
    m = (r > 58) & (r < 90) & (g > 105) & (g < 140) & (b > 135) & (b < 168)         & (b - g > 15) & (g - r > 35)
    # пропускаем левую-верхнюю панель "Информация" и считаем по гистограммам
    if m.sum() < ZONE_MIN_AREA * (w * h) / (BASE_W * BASE_H):
        return None
    cols = m.sum(axis=0)
    rows = m.sum(axis=1)
    xs = np.where(cols > cols.max() * 0.4)[0]
    ys = np.where(rows > rows.max() * 0.4)[0]
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    area = (x1 - x0) * (y1 - y0)
    if area <= 0 or m[y0:y1, x0:x1].mean() < 0.5:
        return None
    return int((x0 + x1) / 2), int((y0 + y1) / 2)


def _components(mask):
    """Связные компоненты (8-соседство) маленькой бинарной маски."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        stack, pts = [(y0, x0)], []
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        yield pts


def alt_prompt_visible(img):
    """Справа на экране подсказка «Разровнять асфальт - ALT Действие»
    (белая плашка с ALT). Пока она видна, мини-игра не идёт - не кликаем."""
    h, w = img.shape[:2]
    sx, sy = w / BASE_W, h / BASE_H
    box = img[int(536 * sy):int(560 * sy), int(1660 * sx):int(1702 * sx)]
    if box.size == 0:
        return False
    white = (box.min(axis=2) >= 225).mean()
    line = img[int(581 * sy):int(584 * sy), int(1660 * sx):int(1820 * sx)]
    return white > 0.55 and (line.min(axis=2) >= 225).mean() > 0.6


def find_circle_arc(img):
    """Мини-игра с кругом и белой дугой вокруг персонажа (центр экрана).
    True, если в центральной области есть отдельная тонкая белая дуга
    (буквы надписей и мелкий белый шум отбрасываются по размеру/форме)."""
    h, w = img.shape[:2]
    rw, rh = int(320 * w / BASE_W), int(320 * h / BASE_H)
    roi = img[max(0, h // 2 - rh):h // 2 + rh, max(0, w // 2 - rw):w // 2 + rw]
    m = roi.min(axis=2) >= 240            # почти чисто белые пиксели
    k = (w * h) / (BASE_W * BASE_H)
    if m.sum() > 12000 * k:               # слишком много белого (небо, меню)
        return False
    for pts in _components(m):
        n = len(pts)
        if not (ARC_MIN * k <= n <= ARC_MAX * k):
            continue
        ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
        bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if 35 <= bw <= 220 and 35 <= bh <= 220 and n / (bw * bh) < 0.3:
            return (n, bw, bh, min(xs), min(ys))
    return False


def test(path):
    from PIL import Image
    img = np.array(Image.open(path).convert("RGB"))
    found = find_cracked(img, verbose=True)
    print("Трубы, центр области:", find_pipe_zone(img))
    print("Подсказка ALT:", alt_prompt_visible(img))
    print("Круг с дугой:", find_circle_arc(img))
    print("Игра обнаружена:", found is not None)
    print("Треснувшие:", [(r, c) for r, c, _, _ in (found or [])])


_last_dump = {}


def debug_dump(img, name, info):
    """Пишет в консоль, какой детектор кликнул, и раз в 3 с сохраняет кадр
    в папку debug_clicks/ - чтобы можно было посмотреть, на что среагировал бот."""
    import os
    from PIL import Image
    print(f"[клик: {name}] {info}")
    now = time.time()
    if now - _last_dump.get(name, 0) > 3:
        _last_dump[name] = now
        os.makedirs("debug_clicks", exist_ok=True)
        Image.fromarray(img).save(f"debug_clicks/{name}_{int(now)}.png")


def run():
    import keyboard
    import mss
    import pyautogui

    pyautogui.PAUSE = 0
    pyautogui.FAILSAFE = True   # мышь в угол экрана = аварийная остановка
    paused = False
    clicked = set()

    def toggle():
        nonlocal paused
        paused = not paused
        print("ПАУЗА" if paused else "РАБОТАЕТ")

    keyboard.add_hotkey("f6", toggle)
    print("Автоматический режим: бот сам ждёт мини-игру и жмёт трещины.")
    print("F6 - пауза/продолжить, F7 - выход.")

    in_game = False
    last_zone_click = 0.0
    last_arc_click = 0.0
    with mss.mss() as sct:
        mon = sct.monitors[1]
        while not keyboard.is_pressed("f7"):
            if paused:
                time.sleep(0.1)
                continue
            shot = np.array(sct.grab(mon))[:, :, :3][:, :, ::-1]  # BGRA -> RGB
            zone = find_pipe_zone(shot)
            if zone is not None:              # ремонт труб: кликаем в область
                if time.time() - last_zone_click > ZONE_CLICK_PAUSE:
                    debug_dump(shot, "pipes", zone)
                    pyautogui.click(mon["left"] + zone[0], mon["top"] + zone[1])
                    last_zone_click = time.time()
                    print("Клик по области труб", zone)
                time.sleep(0.05)
                continue
            found = find_cracked(shot)
            arc = None
            if ARC_ENABLED and found is None and not alt_prompt_visible(shot):
                arc = find_circle_arc(shot)
            if arc:                                       # круг с дугой
                if time.time() - last_arc_click > ARC_CLICK_PAUSE:
                    debug_dump(shot, "arc", arc)
                    pyautogui.mouseDown()     # клик там, где сейчас курсор,
                    time.sleep(0.03)          # с короткой задержкой - игра
                    pyautogui.mouseUp()       # иногда не видит мгновенный клик
                    last_arc_click = time.time()
                continue
            if found is None:                 # мини-игры нет на экране
                if in_game:
                    print("Мини-игра закончилась")
                in_game = False
                clicked.clear()
                time.sleep(IDLE_DELAY)
                continue
            if not in_game:
                print("Мини-игра найдена!")
                in_game = True
            if not found:
                clicked.clear()
                time.sleep(RESCAN_DELAY)
                continue
            for r, c, x, y in found:
                if (r, c) in clicked or paused:
                    continue
                debug_dump(shot, "asphalt", (r, c))
                pyautogui.click(mon["left"] + x, mon["top"] + y)
                clicked.add((r, c))
                time.sleep(CLICK_PAUSE)
            time.sleep(RESCAN_DELAY)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--test":
        test(sys.argv[2])
    else:
        run()
