script_name('ARZ Terminal Price Scan')
script_author('arz-terminal')
script_description('OPT-IN: walks the Central Market "average price" window and opens each item history (arz_export.lua records it)')
script_version('0.1')

-- ARZ Terminal — автообход окна «Средняя цена товаров при продаже».
--
-- ЭТО НЕ ТОЛЬКО ЧТЕНИЕ: скрипт сам «нажимает» кнопки в диалогах — отправляет
-- серверу ровно те же ответы на диалог, что отправил бы твой клик. Поэтому он
-- по умолчанию молчит и работает только после команды /arzscan. Читать и
-- записывать цены по-прежнему делает arz_export.lua (он должен быть включён).
--
-- Как пользоваться:
--   1. /arzscan [fast|мс] [N]  — «взвести» обход; N = сколько первых предметов пропустить (продолжить после СТОП:
--      при остановке в чат печатается готовая команда «Resume: /arzscan 400 209») (скрипт ничего не нажимает сам по себе).
--      /arzscan 300 — своя пауза: 300–480 мс (число от 150 до 5000, ниже/выше обрезается)
--   2. Открыть на Центральном рынке «Средняя цена товаров при продаже» (1-я страница)
--   3. Дальше скрипт сам: открывает 1-й предмет -> история за 30 дней -> «Назад» -> следующий
--      предмет ... -> «Следующая страница» -> так до конца списка.
--   /arzscan stop   — остановить в любой момент (или просто закрыть окно: сработает таймаут)
--   /arzscan status — где сейчас
--
-- Осторожность (ради аккаунта):
--   * паузы между нажатиями 0.4–0.8 с (/arzscan fast — 0.25–0.5 с, быстрее, но рискованнее);
--   * любое неожиданное окно / несовпадение названия / таймаут -> сразу СТОП;
--   * потолок нажатий за запуск (MAX_ACTIONS = 8000) и страниц (MAX_PAGES = 200);
--     при остановке по потолку в чат печатается команда продолжения.
-- Серверные правила могут запрещать автоматизацию действий — риск на тебе.
-- Сообщения в чат только латиницей (кодировка чата CP1251).

local LIST_TITLE  = 'Средняя цена товаров при продаже'
local HIST_PREFIX = "Продажа товара '"      -- хвост « за последние 30 дней» у длинных названий обрезается
local NEXT_ROW    = 'Следующая страница'
local PREV_ROW    = 'Предыдущая страница'
local SEARCH_ROW  = 'Поиск по названию'

local DELAY_NORMAL = { 400, 800 }          -- мс между нажатиями (по умолчанию)
local DELAY_FAST   = { 250, 500 }          -- /arzscan fast: быстрее, но выше риск спам-защиты сервера
local DELAY_FLOOR  = 150                       -- ниже не даём ни при каком числе (защита от опечатки)
local DELAY_CEIL   = 5000

--- /arzscan 300 -> пауза от 300 до 480 мс (число = нижняя граница, верхняя = ×1.6)
local function delay_from_number(n)
    n = math.max(DELAY_FLOOR, math.min(DELAY_CEIL, math.floor(n)))
    return { n, math.floor(n * 1.6) }
end
local TIMEOUT_MS  = 10000                -- ждём ответ сервера на нажатие
-- Весь список ~2300 предметов (56+ страниц, отсортирован по числу продаж: хвост — редкие предметы),
-- полный обход = около 5000 нажатий. Потолок нужен как страховка от зацикливания, а не как ограничение.
-- ARZ_SCAN_LIMITS — только для тестов.
local LIM         = rawget(_G, 'ARZ_SCAN_LIMITS') or {}
local MAX_ACTIONS = LIM.actions or 8000
local MAX_PAGES   = LIM.pages or 200

local S = nil   -- состояние обхода; nil = ничего не делаем

local function now_ms() return os.clock() * 1000 end

local function say(msg)
    sampAddChatMessage('[ARZ Scan] ' .. msg, 0xFFB4E6A0)
end

local function to_utf8(str)
    local ok, enc = pcall(require, 'encoding')
    if ok and enc then
        enc.default = 'CP1251'
        local ok2, r = pcall(function() return enc.UTF8:encode(str) end)
        if ok2 and r then return r end
    end
    return str
end

local function strip(s) return (s:gsub('{%x%x%x%x%x%x}', '')) end
local function trim(s) return (s:gsub('^%s+', ''):gsub('%s+$', '')) end

local function summary()
    return string.format('pages %d, items done %d, clicks %d', #S.pages, S.skip + S.done, S.actions)
end

--- Команда, которой можно продолжить с того же места (пропустить уже сделанные).
local function resume_hint()
    return string.format('Resume: /arzscan %d %d', S.delay[1], S.skip + S.done)
end

local function stop(reason)
    if S then
        say('STOPPED: ' .. reason .. ' (' .. summary() .. ')')
        if S.started then say(resume_hint()) end
    end
    S = nil
end

local function finish(reason)
    if S then say('DONE: ' .. reason .. ' (' .. summary() .. ')') end
    S = nil
end

--- Первая строка — заголовок колонок (style 5), дальше строки с табами.
--- listitem = номер строки без заголовка, считая с нуля.
local function parse_list(text)
    -- names — множество имён страницы (для опознания страницы), occ — какой по счёту предмет с таким именем
    -- на странице: имена в списке повторяются («Часы» x8, три «Майнкрафт» подряд)
    local info = { items = {}, nextIdx = nil, prevIdx = nil, names = {} }
    local n, first, occ = 0, true, {}
    for line in (text .. '\n'):gmatch('(.-)\r?\n') do
        if first then
            first = false
        elseif line ~= '' then
            local name = trim(strip(line:match('^([^\t]*)')))
            if name == NEXT_ROW then info.nextIdx = n
            elseif name == PREV_ROW then info.prevIdx = n
            elseif name ~= SEARCH_ROW and name ~= '' then
                occ[name] = (occ[name] or 0) + 1
                info.items[#info.items + 1] = { name = name, listitem = n, occ = occ[name] }
                info.names[name] = true
            end
            n = n + 1
        end
    end
    return info
end

local function schedule(id, listitem)
    S.action = { at = now_ms() + math.random(S.delay[1], S.delay[2]), id = id, listitem = listitem }
end

local function go(id, which, idx)
    if not idx then return finish('no "' .. which .. '" row in the list (end of list)') end
    S.nav = which
    schedule(id, idx)
end

--- Какую из известных страниц показывает игра. Опознаём по СОСТАВУ, а не по первому имени:
--- в хвосте списка имена повторяются (страница из трёх «Майнкрафт» подряд), а порядок со временем
--- чуть плывёт (список отсортирован по числу продаж, пока идёт обход, продажи случаются).
--- Та же страница — если не меньше 60% её предметов уже встречались на одной из известных.
local function find_page(info)
    local best, best_i = 0, nil
    for i, set in ipairs(S.pages) do
        local common = 0
        for _, it in ipairs(info.items) do
            if set[it.name] then common = common + 1 end
        end
        if common > best then best, best_i = common, i end
    end
    if best_i and best >= 0.6 * #info.items then return best_i end
    return nil
end

--- Ключ «этот предмет уже открыт»: страница + имя + какой по счёту с таким именем (дубли не склеиваем).
local function vkey(page, it)
    return page .. '|' .. it.name .. '#' .. it.occ
end

--- Новая страница: первые S.skip предметов (по всему списку) считаем уже сделанными.
local function note_new_page(info, page)
    for _, it in ipairs(info.items) do
        S.counted = S.counted + 1
        if S.counted <= S.skip then S.visited[vkey(page, it)] = true end
    end
end

local function handle_list(id, info)
    if #info.items == 0 then return stop('empty list') end
    local idx = find_page(info)

    if S.nav == 'next' then
        if idx == S.cur then return finish('last page reached (Next did nothing)') end
        if idx and idx ~= S.cur + 1 then
            if idx == 1 then return finish('wrapped to the first page') end
            return stop('page mismatch after Next')
        end
        if not idx then
            if S.cur ~= #S.pages then return stop('unknown page after Next on a known page') end
            S.pages[#S.pages + 1] = info.names
            idx = #S.pages
            note_new_page(info, idx)
        end
        S.cur = idx
    elseif S.nav == 'prev' then
        if not idx then return stop('unknown page after Previous') end
        S.cur = idx
    elseif not S.started then
        S.pages[1] = info.names
        note_new_page(info, 1)
        S.started = true
        S.cur, S.work = 1, 1
    else
        -- вернулись из истории предмета: игра могла показать эту же страницу или первую
        if not idx then return stop('unknown page after the item history') end
        S.cur = idx
    end
    S.nav = nil
    if #S.pages > MAX_PAGES then return stop('page limit') end

    if S.cur < S.work then return go(id, 'next', info.nextIdx) end
    if S.cur > S.work then return go(id, 'prev', info.prevIdx) end

    for _, it in ipairs(info.items) do
        local k = vkey(S.cur, it)
        if not S.visited[k] then
            S.visited[k] = true
            S.expect = it.name
            return schedule(id, it.listitem)
        end
    end
    S.work = S.work + 1            -- на этой странице всё открыто
    return go(id, 'next', info.nextIdx)
end

--- Заголовок: Продажа товара 'ИМЯ' за последние 30 дней. Сервер режет его по длине:
--- сначала пропадает хвост «30 дней», у совсем длинных имён — часть имени (и кавычка).
--- Хвост может быть обрезан где угодно («' за пос»), у имён бывают пробелы на конце
--- («Аркана ИО » — в списке и в заголовке), поэтому сравниваем имена без крайних пробелов.
local HIST_TAIL = " за последние 30 дней"

local function history_matches(title, expect)
    if title:sub(1, #HIST_PREFIX) ~= HIST_PREFIX then return false end
    local rest = title:sub(#HIST_PREFIX + 1)
    -- имя целиком: ищем кавычку, после которой идёт начало (возможно, обрезанного) стандартного хвоста
    local pos = 0
    while true do
        pos = rest:find("'", pos + 1, true)
        if not pos then break end
        local tail = rest:sub(pos + 1)
        if HIST_TAIL:sub(1, #tail) == tail then
            return trim(rest:sub(1, pos - 1)) == expect
        end
    end
    -- кавычки нет: заголовок обрезан внутри имени
    local part = trim(rest)
    return #part > 0 and expect:sub(1, #part) == part
end

--- Подробности несовпадения — в файл рядом со скриптом (в чат кириллицу из UTF-8 не выведешь).
local function debug_log(msg)
    pcall(function()
        local f = io.open(getWorkingDirectory() .. '\\arz_scan_debug.log', 'ab')
        if f then
            f:write(os.date('%Y-%m-%d %H:%M:%S') .. ' ' .. msg .. '\n')
            f:close()
        end
    end)
end

local function handle_history(id, title)
    if not S.expect then return stop('history window that we did not open') end
    if not history_matches(title, S.expect) then
        debug_log('MISMATCH expected=[' .. S.expect .. '] title=[' .. title .. ']')
        return stop('history belongs to another item (row index mismatch) - details in arz_scan_debug.log')
    end
    S.expect = nil
    S.done = S.done + 1
    if S.done % 10 == 0 then say(summary()) end
    schedule(id, 0)    -- кнопка 1 = «Назад» -> снова список
end

local function on_dialog(id, style, title, text)
    if not S then return end
    local t = strip(to_utf8(title or ''))
    if t:find(LIST_TITLE, 1, true) then
        if style ~= 5 then return stop('the list window has an unexpected style') end
        S.waiting = false
        handle_list(id, parse_list(to_utf8(text or '')))
    elseif S.started and t:sub(1, #HIST_PREFIX) == HIST_PREFIX then
        S.waiting = false
        handle_history(id, t)
    elseif S.started then
        stop('unexpected window: ' .. strip(title or ''):sub(1, 40))
    end
    -- до старта чужие окна игнорируем
end

local function tick()
    if not S then return end
    local t = now_ms()
    if S.action and t >= S.action.at then
        local a = S.action
        S.action = nil
        if S.actions >= MAX_ACTIONS then return stop('click limit') end
        S.actions = S.actions + 1
        S.waiting, S.sentAt = true, t
        sampSendDialogResponse(a.id, 1, a.listitem, '')
    elseif S.waiting and not S.action and t - S.sentAt > TIMEOUT_MS then
        if S.nav == 'next' and S.cur == #S.pages then
            finish('end of list (no reply to Next)')
        else
            stop('timeout: no window after the last click')
        end
    end
end

local function install_hook()
    local ok, sampev = pcall(require, 'samp.events')
    if not ok or not sampev then return false end
    function sampev.onShowDialog(id, style, title, button1, button2, text)
        pcall(on_dialog, id, style, title, text)
        -- ничего не возвращаем -> окно показывается как обычно
    end
    return true
end

local function new_state(delay, skip)
    return { delay = delay or DELAY_NORMAL, skip = skip or 0, counted = 0, pages = {}, cur = 0, work = 0, nav = nil, started = false, visited = {},
             done = 0, actions = 0, action = nil, waiting = false }
end

function main()
    repeat wait(100) until isSampAvailable()
    local hooked = install_hook()
    sampRegisterChatCommand('arzscan', function(arg)
        arg = (arg or ''):lower()
        if arg == 'stop' then
            if S then stop('stopped by /arzscan stop') else say('not running') end
        elseif arg == 'status' then
            if S then say((S.started and 'running: ' or 'armed, waiting for the price window: ') .. summary()) else say('idle') end
        else
            local a1, a2 = arg:match('^(%S*)%s*(%S*)')
            local num, skip = tonumber(a1), tonumber(a2)
            local delay = DELAY_NORMAL
            if a1 == 'fast' then delay = DELAY_FAST
            elseif num then delay = delay_from_number(num) end
            skip = skip and math.max(0, math.floor(skip)) or 0
            S = new_state(delay, skip)
            say(string.format('armed, pause %d-%d ms%s. Now open Central Market > "Average price (sales)" window on page 1. /arzscan stop cancels.',
                delay[1], delay[2], skip > 0 and (', skipping first ' .. skip .. ' items') or ''))
        end
    end)
    say(hooked and 'ready (idle). /arzscan arms the walk, /arzscan stop cancels.' or 'samp.events not found - scan disabled')
    while true do
        wait(50)
        pcall(tick)
    end
end
