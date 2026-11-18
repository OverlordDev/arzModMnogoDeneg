script_name('ARZ Terminal Recon')
script_author('arz-terminal')
script_description('READ-ONLY: logs CEF events (packet 220) to find inventory / player-state events')
script_version('0.1')

-- ARZ Terminal — скрипт-РАЗВЕДЧИК (шаг 1).
--
-- Что делает: только ЧИТАЕТ входящие CEF-события Arizona (пакет 220,
-- подтип 17, строка window.executeEvent('имя', `данные`)) и пишет их
-- в файл рядом со скриптом. Ничего не отправляет серверу, не кликает,
-- не меняет пакеты (обработчик ничего не возвращает -> пакет идёт дальше).
--
-- Зачем: узнать, как называется событие инвентаря и какой у него формат,
-- прежде чем писать настоящий парсер. Ничего не угадываем — смотрим лог.
--
-- Как пользоваться:
--   1. Скопировать в <Arizona>\bin\arizona\moonloader\ и зайти на сервер.
--   2. Открыть инвентарь (I), закрыть, открыть ещё раз; открыть статистику,
--      телефон, банк, лавку — всё, что хочется потом читать.
--   3. /arzrec — показать в чате сколько разных событий поймано и записать
--      сводку. Результат: moonloader\arz_recon_events.log (образцы данных)
--      и moonloader\arz_recon_summary.txt (все имена событий со счётчиком).
--   4. Прислать оба файла сюда — по ним пишется парсер.
--
-- Формат пакета (по обсуждениям на blast.hk, не по документации):
--   [id=220][int8 подтип=17][32 бита мимо][int16 длина][int8 encoded][строка]
--   encoded ~= 0 -> строка закодирована, читаем DecodeString(длина+encoded).

local MAX_LOG_BYTES  = 8 * 1024 * 1024  -- потолок размера лога
local MAX_PAYLOAD    = 20000            -- символов одного образца
local SAMPLES_DEFAULT = 2               -- образцов на обычное событие
local SAMPLES_HOT     = 30              -- образцов на «интересное» событие
local HOT = { 'inventor', 'item', 'money', 'balance', 'wallet', 'bank',
              'stats', 'player', 'level', 'vip', 'donate', 'slot' }

local enabled  = true
local seen     = {}   -- имя события -> { n = сколько раз, logged = сколько записали }
local written  = 0
local last_dump = 0

local function base_dir()
    return getWorkingDirectory() .. '\\'
end

local function is_hot(name)
    local l = name:lower()
    for _, p in ipairs(HOT) do
        if l:find(p, 1, true) then return true end
    end
    return false
end

local SECRET = { 'event.api.', 'event.auth.', 'token', 'password', 'pass', 'login', 'pin', 'sms', 'mail' }

local function is_secret(name)
    local l = name:lower()
    for _, p in ipairs(SECRET) do
        if l:find(p, 1, true) then return true end
    end
    return false
end

local function append_log(text)
    local f = io.open(base_dir() .. 'arz_recon_events.log', 'ab')
    if f then
        f:write(text)
        f:close()
        written = written + #text
    end
end

local function record(str)
    local name = str:match("executeEvent%('([^']+)'") or '?raw'
    local s = seen[name]
    if not s then
        s = { n = 0, logged = 0 }
        seen[name] = s
    end
    s.n = s.n + 1
    -- Данные авторизации (токены и т.п.) в лог НЕ пишем вообще: считаем
    -- событие в сводке, но содержимое не сохраняем.
    if is_secret(name) then return end
    local limit = is_hot(name) and SAMPLES_HOT or SAMPLES_DEFAULT
    if s.logged >= limit or written > MAX_LOG_BYTES then return end
    s.logged = s.logged + 1
    local payload = str
    if #payload > MAX_PAYLOAD then
        payload = payload:sub(1, MAX_PAYLOAD) .. '...[cut]'
    end
    append_log(string.format('[%s] #%d %s\n%s\n-----\n', os.date('%H:%M:%S'), s.n, name, payload))
end

local function dump_summary()
    local rows = {}
    for name, s in pairs(seen) do
        rows[#rows + 1] = { name = name, n = s.n }
    end
    table.sort(rows, function(a, b) return a.n > b.n end)
    local f = io.open(base_dir() .. 'arz_recon_summary.txt', 'wb')
    if not f then return 0 end
    f:write('events seen: ' .. #rows .. '\n')
    for _, r in ipairs(rows) do
        f:write(string.format('%6d  %s\n', r.n, r.name))
    end
    f:close()
    return #rows
end

local function read_cef_string(bs)
    raknetBitStreamIgnoreBits(bs, 8)                  -- id пакета
    if raknetBitStreamReadInt8(bs) ~= 17 then return nil end  -- не executeEvent
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
    if not enabled or id ~= 220 then return end
    local ok, str = pcall(read_cef_string, bs)
    -- вернуть указатель чтения на начало: другие скрипты и сама игра
    -- должны увидеть пакет нетронутым
    raknetBitStreamResetReadPointer(bs)
    if ok and str and str ~= '' then
        pcall(record, str)
    end
    -- ничего не возвращаем -> пакет НЕ перехватывается
end)

function main()
    repeat wait(100) until isSampAvailable()
    sampRegisterChatCommand('arzrec', function(arg)
        if arg == 'off' then
            enabled = false
            sampAddChatMessage('[ARZ Recon] paused', 0xFFB4E6A0)
        elseif arg == 'on' then
            enabled = true
            sampAddChatMessage('[ARZ Recon] resumed', 0xFFB4E6A0)
        else
            local n = dump_summary()
            sampAddChatMessage(string.format('[ARZ Recon] event names: %d, log: %d KB (/arzrec off|on)', n, math.floor(written / 1024)), 0xFFB4E6A0)
        end
    end)
    sampAddChatMessage('[ARZ Recon] read-only logger is on. Open inventory, then type /arzrec', 0xFFB4E6A0)
    last_dump = os.clock()
    while true do
        wait(1000)
        if os.clock() - last_dump > 60 then
            dump_summary()
            last_dump = os.clock()
        end
    end
end
