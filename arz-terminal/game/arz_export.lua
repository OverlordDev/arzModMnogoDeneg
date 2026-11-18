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
}

local last = {}      -- имя события -> последняя записанная строка (для дедупликации)
local counter = 0
local path

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
    f:write(string.format('[%s] #%d %s\n%s\n-----\n', os.date('%H:%M:%S'), counter, name, str))
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
    end
    -- ничего не возвращаем -> пакет НЕ перехватывается
end)

function main()
    path = file_path()
    pcall(rotate_if_big)
    repeat wait(100) until isSampAvailable()
    sampRegisterChatCommand('arzexp', function()
        sampAddChatMessage('[ARZ Export] writing to ' .. path .. ' (events this run: ' .. counter .. ')', 0xFFB4E6A0)
    end)
    sampAddChatMessage('[ARZ Export] read-only export is on (/arzexp = status)', 0xFFB4E6A0)
    wait(-1)
end
