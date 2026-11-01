local logger     = require("logger")
local millennium = require("millennium")
local utils      = require("utils")

-- All game knowledge lives in heroic-steam-sync; this backend only shells out to it.
local SYNC = os.getenv("HOME") .. "/.local/bin/heroic-steam-sync"

local function run(flag, appid)
    local id = tonumber(appid)
    if not id then
        return '{"error":"bad appid"}'
    end
    local out, status = utils.exec(string.format("%q %s %d", SYNC, flag, id))
    if not out or out == "" then
        logger:error(string.format("%s %d failed: %s", flag, id, tostring(status)))
        return '{"error":"heroic-steam-sync failed"}'
    end
    return out
end

---@ffi
---Every Heroic shortcut as JSON: {appid: {title, store, installed}}.
---@return string
function heroic_list()
    local out, status = utils.exec(string.format("%q --list", SYNC))
    if not out or out == "" then
        logger:error("--list failed: " .. tostring(status))
        return "{}"
    end
    return out
end

---@ffi
---Open Heroic's install prompt for a Steam shortcut appid, as JSON.
---@param appid number
---@return string
function heroic_install(appid)
    logger:info("install requested for " .. tostring(appid))
    return run("--install", appid)
end

---@ffi
---Stop a running direct install for a Steam shortcut appid (resumable), as JSON.
---@param appid number
---@return string
function heroic_stop(appid)
    logger:info("stop requested for " .. tostring(appid))
    return run("--stop", appid)
end

---@ffi
---Cancel a direct install for a Steam shortcut appid and delete its files, as JSON.
---@param appid number
---@return string
function heroic_remove(appid)
    logger:info("remove requested for " .. tostring(appid))
    return run("--remove", appid)
end

local function on_load()
    logger:info("Loaded with Millennium " .. millennium.version())
    millennium.ready()
end

return {
    on_load = on_load,
}
