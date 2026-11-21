script_name('ARZ Terminal Export')
script_author('arz-terminal')
script_description('READ-ONLY: writes inventory / money / status CEF events to a local file for ARZ Terminal')
script_version('1.0')

-- ARZ Terminal — экспортёр состояния игрока.
--
-- ТОЛЬКО ЧИТАЕТ входящие CEF-события Arizona (пакет 220) и дописывает
-- нужные в локальный файл moonloader\arz_player_events.log. Ничего не
-- отправляет серверу и в интернет, не кликает, не меняет и не перехватывает
-- пакеты. Терминал (node server.js на этом же ПК) читает файл сам.
--
-- Белый список: пишутся ТОЛЬКО перечисленные ниже события. Всё остальное
-- (в т.ч. любая авторизация / токены) отбрасывается до записи.
--
-- Формат файла совпадает с логом arz_recon.lua, разбирает game/arz_parser.js.
--
-- Кроме CEF-событий читает окна цен Центрального рынка («Средняя цена товаров»
-- и «Продажа товара ... за последние 30 дней», цены за 30 дней). Они пишутся в
-- отдельный файл arz_market_dialogs.log, разбирает game/arz_gameprices.js.
-- Остальные диалоги (статистика, банк, пароли...) не читаются вообще.
-- Донат-магазин: события event.donateShop.* (название, описание, цена, кулдаун покупки по каждому товару)
-- пишутся в arz_donate_shop.log. Чтобы снять весь каталог, открой магазин и пролистай все категории;
-- /arzshop в чате покажет, сколько товаров уже поймано.
-- Полная загрузка инвентаря приходит ОДИН раз при входе на сервер, поэтому
-- файл не обнуляется при старте скрипта (только если вырос > 2 МБ — тогда
-- уходит в .old). Перезапуск скрипта посреди сессии базу не теряет.

local MAX_BYTES = 2 * 1024 * 1024

local WATCH = {
    ['event.inventory.playerInventory'] = true,
    ['event.player.updateMoney'] = true,
    ['event.arizonahud.playerSatiety'] = true,
    ['event.arizonahud.playerWanted'] = true,
    ['event.arizonahud.playerPower'] = true,
    ['event.arizonahud.playerPowerType'] = true,
    ['event.arizonahud.serverInfo'] = true,
    -- банк: приходят только когда игрок открывает окно банка (депозит, лимит, доход за PayDay, счета)
    ['event.bank.updateDepositData'] = true,
    ['event.bank.updateMainData'] = true,
}

-- Диалоги: только окна цен Центрального рынка (после цветовых кодов в заголовке):
--   «Средняя цена товаров при продаже»            — список предметов со средней ценой за 30 дней
--   «Продажа товара 'X' за последние 30 дней»     — история одного предмета по дням (цена и число продаж)
local DIALOG_MAX_BYTES = 4 * 1024 * 1024
local list_seen = {}   -- текст списка страницы -> когда записан (os.time)

local last = {}      -- имя события -> последняя записанная строка (для дедупликации)
local counter = 0
local path
local write_donate  -- донат-магазин: задаётся ниже, после to_utf8

local function file_path()
    return getWorkingDirectory() .. '\\arz_player_events.log'
end

local function rotate_if_big()
    local f = io.open(path, 'rb')
    if not f then return end
    local size = f:seek('end')
    f:close()
    if size and size > MAX_BYTES then
        os.remove(path .. '.old')
        os.rename(path, path .. '.old')
    end
end

local function write_event(name, str)
    -- Инвентарь пишем всегда (каждое событие — изменение). Остальные
    -- пропускаем, если значение не изменилось (сытость шлётся каждую минуту).
    if name ~= 'event.inventory.playerInventory' then
        if last[name] == str then return end
        last[name] = str
    end
    counter = counter + 1
    local f = io.open(path, 'ab')
    if not f then return end
    -- с датой: по ней терминал считает заработок в час и историю капитала
    f:write(string.format('[%s] #%d %s\n%s\n-----\n', os.date('%Y-%m-%d %H:%M:%S'), counter, name, str))
    f:close()
end

local function read_cef_string(bs)
    raknetBitStreamIgnoreBits(bs, 8)                                 -- id пакета
    if raknetBitStreamReadInt8(bs) ~= 17 then return nil end         -- не executeEvent
    raknetBitStreamIgnoreBits(bs, 32)
    local length  = raknetBitStreamReadInt16(bs)
    local encoded = raknetBitStreamReadInt8(bs)
    if length <= 0 or length > 60000 then return nil end
    if encoded ~= 0 then
        return raknetBitStreamDecodeString(bs, length + encoded)
    end
    return raknetBitStreamReadString(bs, length)
end

addEventHandler('onReceivePacket', function(id, bs)
    if id ~= 220 then return end
    local ok, str = pcall(read_cef_string, bs)
    -- вернуть указатель чтения на начало: игра и другие скрипты видят пакет нетронутым
    raknetBitStreamResetReadPointer(bs)
    if not ok or not str or str == '' then return end
    local name = str:match("executeEvent%('([^']+)'")
    if name and WATCH[name] then
        pcall(write_event, name, str)
    elseif name and write_donate and name:find('^event%.donateShop%.') then
        pcall(write_donate, name, str)         -- донат-магазин: только его события, всё остальное отбрасываем
    end
    -- ничего не возвращаем -> пакет НЕ перехватывается
end)

-- ── Диалоги рынка (SA-MP RPC), только чтение ───────────────────────
local function to_utf8(str)
    local ok, enc = pcall(require, 'encoding')
    if ok and enc then
        enc.default = 'CP1251'
        local ok2, r = pcall(function() return enc.UTF8:encode(str) end)
        if ok2 and r then return r end
    end
    return str
end

-- ── Донат-магазин (CEF event.donateShop.*), только чтение ──────────
-- Магазин шлёт данные мелкими событиями по товару: название, описание, цена, видимость, причина блокировки
-- («Повторная покупка будет доступна через N минут»). Пишем ВСЕ такие события (кроме точных повторов) в
-- arz_donate_shop.log в UTF-8; список подгружается, когда в магазине открывают категории, поэтому чтобы снять
-- весь каталог, нужно один раз пролистать все категории. Разбор — на стороне терминала.
local DONATE_MAX_BYTES = 1024 * 1024
local DONATE_SEEN_MAX  = 6000
local donate_seen, donate_seen_n = {}, 0
local donate_keys, donate_named, donate_priced = {}, {}, {}
local donate_counter = 0

local function donate_path()
    return getWorkingDirectory() .. '\\arz_donate_shop.log'
end

local function count_keys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

write_donate = function(name, str)
    local utf = to_utf8(str)
    local id = name .. '|' .. utf
    if donate_seen[id] then return end                 -- точный повтор: не раздуваем файл
    if donate_seen_n >= DONATE_SEEN_MAX then donate_seen, donate_seen_n = {}, 0 end
    donate_seen[id] = true
    donate_seen_n = donate_seen_n + 1
    local key = utf:match('"key"%s*:%s*(%d+)')         -- статистика для /arzshop
    if key then
        donate_keys[key] = true
        if utf:find('"name"%s*:%s*"[^"]') then donate_named[key] = true end
        if utf:find('"price"%s*:%s*%d') then donate_priced[key] = true end
    end
    local p = donate_path()
    local f = io.open(p, 'rb')
    if f then
        local size = f:seek('end')
        f:close()
        if size and size > DONATE_MAX_BYTES then
            os.remove(p .. '.old')
            os.rename(p, p .. '.old')
        end
    end
    local out = io.open(p, 'ab')
    if not out then return end
    donate_counter = donate_counter + 1
    out:write(string.format('[%s] #%d %s\n%s\n-----\n', os.date('%Y-%m-%d %H:%M:%S'), donate_counter, name, utf))
    out:close()
end

local function dialog_path()
    return getWorkingDirectory() .. '\\arz_market_dialogs.log'
end

local function watched_title(title)
    if title:find('Средняя цена товаров', 1, true) then return true end
    -- у длинных названий сервер режет заголовок («... за последние» без «30 дней», а то и часть имени),
    -- поэтому ориентируемся только на начало
    local plain = (title:gsub('{%x%x%x%x%x%x}', ''))
    return plain:find("Продажа товара '", 1, true) == 1 or plain:find("Покупка товара '", 1, true) == 1
end

local function write_dialog(dialogId, style, title, text)
    local t = to_utf8(title or '')
    if not watched_title(t) then return end          -- всё остальное отбрасываем до записи
    -- Список страницы игра показывает заново после каждого «Назад» из истории предмета:
    -- одинаковый текст недавно уже записан — не раздуваем файл.
    if t:find('Средняя цена товаров', 1, true) then
        local key = text or ''
        local seen = list_seen[key]
        if seen and os.time() - seen < 600 then return end
        list_seen[key] = os.time()
    end
    local p = dialog_path()
    local f = io.open(p, 'rb')
    if f then
        local size = f:seek('end')
        f:close()
        if size and size > DIALOG_MAX_BYTES then
            os.remove(p .. '.old')
            os.rename(p, p .. '.old')
        end
    end
    local out = io.open(p, 'ab')
    if not out then return end
    out:write(string.format('[%s] DIALOG id=%s style=%s title=%s\n%s\n-----\n',
        os.date('%Y-%m-%d %H:%M:%S'), tostring(dialogId), tostring(style), t, to_utf8(text or '')))
    out:close()
end

-- ── Банковский чек PayDay (чат), только чтение ──────────────────────
-- В чат на каждый PayDay приходит «БАНКОВСКИЙ ЧЕК»: сумма в банке и на депозите с прибавкой, зарплата, баланс AZ,
-- опыт. Это единственное место, где видно, сколько реально капает за выплату (деньги идут на счёт и депозит,
-- а не в наличные). Пишем ТОЛЬКО эти строки (остальной чат не читается и не сохраняется).
local PAYDAY_MAX_BYTES = 512 * 1024

local function payday_path()
    return getWorkingDirectory() .. '\\arz_payday.log'
end

local function payday_line(plain)
    if plain:find('БАНКОВСКИЙ ЧЕК', 1, true) then return true end
    if plain:find('Текущая сумма в банке', 1, true) then return true end
    if plain:find('Текущая сумма на депозите', 1, true) then return true end
    if plain:find('Общая заработная плата', 1, true) then return true end
    if plain:find('Баланс на донат-счет', 1, true) then return true end
    return plain:find('уровень', 1, true) ~= nil and plain:find('респектов', 1, true) ~= nil
end

local function write_payday_line(text)
    local plain = (to_utf8(text or ''):gsub('{%x%x%x%x%x%x}', ''))
    if not payday_line(plain) then return end           -- всё остальное в чате отбрасываем до записи
    local p = payday_path()
    local f = io.open(p, 'rb')
    if f then
        local size = f:seek('end')
        f:close()
        if size and size > PAYDAY_MAX_BYTES then
            os.remove(p .. '.old')
            os.rename(p, p .. '.old')
        end
    end
    local out = io.open(p, 'ab')
    if not out then return end
    out:write(string.format('[%s] CHAT %s\n', os.date('%Y-%m-%d %H:%M:%S'), plain))
    out:close()
end

local function install_dialog_hook()
    local ok, sampev = pcall(require, 'samp.events')
    if not ok or not sampev then return false end
    function sampev.onShowDialog(dialogId, style, title, button1, button2, text)
        pcall(write_dialog, dialogId, style, title, text)
        -- ничего не возвращаем -> диалог НЕ блокируется и не меняется
    end
    function sampev.onServerMessage(color, text)
        pcall(write_payday_line, text)
        -- ничего не возвращаем -> сообщение показывается как обычно
    end
    return true
end

function main()
    path = file_path()
    pcall(rotate_if_big)
    repeat wait(100) until isSampAvailable()
    local dialogs_ok = install_dialog_hook()
    sampRegisterChatCommand('arzexp', function()
        sampAddChatMessage('[ARZ Export] writing to ' .. path .. ' (events this run: ' .. counter .. ')', 0xFFB4E6A0)
    end)
    sampRegisterChatCommand('arzshop', function()
        sampAddChatMessage(string.format('[ARZ Export] донат-магазин: товаров %d, с названием %d, с ценой %d (файл arz_donate_shop.log). Открой магазин и пролистай все категории',
            count_keys(donate_keys), count_keys(donate_named), count_keys(donate_priced)), 0xFFB4E6A0)
    end)
    sampAddChatMessage('[ARZ Export] read-only export is on (/arzexp = status, /arzshop = донат-магазин)' ..
        (dialogs_ok and ', market price dialogs + PayDay check: on' or ', market dialogs/PayDay check: samp.events not found'), 0xFFB4E6A0)
    wait(-1)
end
