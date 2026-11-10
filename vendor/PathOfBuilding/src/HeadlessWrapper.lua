#@
---@diagnostic disable: lowercase-global
-- This wrapper allows the program to run headless on any OS (in theory)
-- It can be run using a standard lua interpreter, although LuaJIT is preferable

-- define global SimpleGraphic API functions. some of these have dummy function
-- bodies intended for headless use.
dofile("_SimpleGraphic.def.lua")

function GetVirtualScreenSize()
	return 1920, 1080
end

-- Callbacks
__callbackTable__ = { }

-- General Functions
function SetWindowTitle(title) end
function GetCursorPos()
	return 0, 0
end
function SetCursorPos(x, y) end
function ShowCursor(doShow) end
function IsKeyDown(keyName) end
function Copy(text) end
function Paste() end
do
	local ffi = require("ffi")
	ffi.cdef[[
		unsigned long compressBound(unsigned long sourceLen);
		int compress(uint8_t *dest, unsigned long *destLen,
		             const uint8_t *source, unsigned long sourceLen);
		int uncompress(uint8_t *dest, unsigned long *destLen,
		               const uint8_t *source, unsigned long sourceLen);
	]]
	local zlib = ffi.load("z")

	function Deflate(data)
		if not data or #data == 0 then return "" end
		local sourceLen = #data
		local destLen = ffi.new("unsigned long[1]", zlib.compressBound(sourceLen))
		local dest = ffi.new("uint8_t[?]", destLen[0])
		local ret = zlib.compress(dest, destLen, data, sourceLen)
		if ret ~= 0 then return nil end
		return ffi.string(dest, destLen[0])
	end

	function Inflate(data)
		if not data or #data == 0 then return nil end
		local sourceLen = #data
		for mult = 4, 256, 4 do
			local destLen = ffi.new("unsigned long[1]", sourceLen * mult)
			local dest = ffi.new("uint8_t[?]", destLen[0])
			local ret = zlib.uncompress(dest, destLen, data, sourceLen)
			if ret == 0 then return ffi.string(dest, destLen[0])
			elseif ret ~= -5 then return nil end  -- -5 = Z_BUF_ERROR, retry with larger buffer
		end
		return nil
	end
end
function GetTime()
	return 0
end
function GetScriptPath()
	return "."
end
function GetRuntimePath()
	return "."
end
function GetUserPath()
	return ""
end
function MakeDir(path)
	os.execute("mkdir -p " .. path)
end
function RemoveDir(path) end
function SetWorkDir(path) end
function GetWorkDir()
	return ""
end
function LaunchSubScript(scriptText, funcList, subList, ...) end
function AbortSubScript(ssID) end
function IsSubScriptRunning(ssID) end
function LoadModule(fileName, ...)
	if not fileName:match("%.lua") then
		fileName = fileName .. ".lua"
	end
	local func, err = loadfile(fileName)
	if func then
		return func(...)
	else
		error("LoadModule() error loading '"..fileName.."': "..err)
	end
end

function runCallback(name, ...)
	if __callbackTable__[name] then
		return __callbackTable__[name](...)
	elseif __mainObject__ and __mainObject__[name] then
		return __mainObject__[name](__mainObject__, ...)
	end
end

local l_require = require
function require(name)
	-- Hack to stop it looking for lcurl, which we don't really need
	if name == "lcurl.safe" then
		return
	end
	return l_require(name)
end

-- Determine script directory for robust relative loading
local function get_script_dir()
  local info = debug and debug.getinfo and debug.getinfo(1, 'S')
  local src = info and info.source or ''
  if type(src) == 'string' and src:sub(1,1) == '@' then
    local path = src:sub(2)
    return (path:gsub('[^/\\]+$', '')):gsub('[ /\\]$', '')
  end
  return ''
end
local POB_SCRIPT_DIR = get_script_dir()
-- If script dir unknown (e.g., launched as 'luajit HeadlessWrapper.lua'), fall back:
if POB_SCRIPT_DIR == '' then
  -- Case 1: running inside src
  local f1 = io.open('HeadlessWrapper.lua', 'r')
  if f1 then f1:close(); POB_SCRIPT_DIR = '.' end
end
if POB_SCRIPT_DIR == '' then
  -- Case 2: running from repo root
  local f2 = io.open('src/HeadlessWrapper.lua', 'r')
  if f2 then f2:close(); POB_SCRIPT_DIR = 'src' end
end
if POB_SCRIPT_DIR ~= '' then
  _G.POB_SCRIPT_DIR = POB_SCRIPT_DIR
  local pathSegs = {}
  table.insert(pathSegs, POB_SCRIPT_DIR .. '/?.lua')
  table.insert(pathSegs, POB_SCRIPT_DIR .. '/?/init.lua')
  table.insert(pathSegs, package.path)
  package.path = table.concat(pathSegs, ';')
  -- Add runtime lua path so modules like 'xml' resolve without external LUA_PATH
  local runtimeCandidates = {
    POB_SCRIPT_DIR .. '/runtime/lua',
    POB_SCRIPT_DIR .. '/../runtime/lua',
    'runtime/lua',
    '../runtime/lua',
  }
  for _, rp in ipairs(runtimeCandidates) do
    local test = io.open(rp .. '/xml.lua', 'r')
    if test then
      test:close()
      local seg = rp .. '/?.lua;"' .. rp .. '/?/init.lua"'
      if not string.find(package.path, rp .. '/?.lua', 1, true) then
        package.path = rp .. '/?.lua;' .. rp .. '/?/init.lua;' .. package.path
      end
      break
    end
  end
end

-- Allow CLI flag in addition to env var to start stdio server
local function has_flag(flag)
  if type(arg) ~= 'table' then return false end
  for i = 1, #arg do if arg[i] == flag then return true end end
  return false
end

-- If requested, start the stdio server immediately and exit
if os.getenv('POB_API_STDIO') == '1' or has_flag('--stdio') then
  -- Provide utf8 fallback if not present to avoid requiring external luautf8
  if type(_G.utf8) ~= 'table' then
    local ok_u, mod = pcall(require, 'utf8')
    if not ok_u or type(mod) ~= 'table' then
      local stubCandidates = {
        (POB_SCRIPT_DIR ~= '' and (POB_SCRIPT_DIR .. '/utf8.lua')) or nil,
        (POB_SCRIPT_DIR ~= '' and (POB_SCRIPT_DIR .. '/lua-utf8.lua')) or nil,
        'src/utf8.lua', 'src/lua-utf8.lua'
      }
      for _, sp in ipairs(stubCandidates) do
        if sp then
          local ok2, stub = pcall(dofile, sp)
          if ok2 and type(stub) == 'table' then _G.utf8 = stub; break end
        end
      end
    else
      _G.utf8 = mod
    end
  end
  -- Load Launch.lua first to initialize __mainObject__ and build system
  dofile("Launch.lua")

  -- Initialize the build system (same as non-STDIO mode)
  __mainObject__.continuousIntegrationMode = os.getenv("CI")
  runCallback("OnInit")
  runCallback("OnFrame") -- Need at least one frame for everything to initialise

  if __mainObject__.promptMsg then
    -- Something went wrong during startup
    io.stderr:write('[HeadlessWrapper] Error during init: ' .. tostring(__mainObject__.promptMsg) .. '\n')
    error(__mainObject__.promptMsg)
  end

  -- Set up helper functions
  function newBuild()
    __mainObject__.main:SetMode("BUILD", false, "Help, I'm stuck in Path of Building!")
    runCallback("OnFrame")
  end
  function loadBuildFromXML(xmlText, name)
    __mainObject__.main:SetMode("BUILD", false, name or "", xmlText)
    runCallback("OnFrame")
  end
  _G.newBuild = newBuild
  _G.loadBuildFromXML = loadBuildFromXML
  _G.build = __mainObject__.main.modes["BUILD"]

  -- Now start the API server
  local srvPath = (POB_SCRIPT_DIR ~= '' and (POB_SCRIPT_DIR .. '/API/Server.lua')) or 'API/Server.lua'
  dofile(srvPath)
  return
end

-- Add PoB runtime lua path for external luajit runs
do
  local candidates = { "../runtime/lua", "runtime/lua", "../../runtime/lua" }
  for _, p in ipairs(candidates) do
    local f = io.open(p .. "/xml.lua", "r")
    if f then f:close()
      if not string.find(package.path, p .. "/?.lua", 1, true) then
        package.path = package.path .. ";" .. p .. "/?.lua"
      end
    end
  end
end
dofile("Launch.lua")

-- Prevents loading of ModCache
-- Allows running mod parsing related tests without pushing ModCache
-- The CI env var will be true when run from github workflows but should be false for other tools using the headless wrapper
__mainObject__.continuousIntegrationMode = os.getenv("CI")

runCallback("OnInit")
runCallback("OnFrame") -- Need at least one frame for everything to initialise

if __mainObject__.promptMsg then
	-- Something went wrong during startup
	print(__mainObject__.promptMsg)
	io.read("*l")
	return
end

-- The build module; once a build is loaded, you can find all the good stuff in here
build = __mainObject__.main.modes["BUILD"]

-- Here's some helpful helper functions to help you get started
function newBuild()
	__mainObject__.main:SetMode("BUILD", false, "Help, I'm stuck in Path of Building!")
	runCallback("OnFrame")
end
function loadBuildFromXML(xmlText, name)
	__mainObject__.main:SetMode("BUILD", false, name or "", xmlText)
	runCallback("OnFrame")
end
function loadBuildFromJSON(characterJSON)
	__mainObject__.main:SetMode("BUILD", false, "")
	runCallback("OnFrame")
	-- characterJSON could, for example, be the response from the PoE API:
	-- https://www.pathofexile.com/developer/docs/reference#characters-get
	local dkjson = require "dkjson"
	local input = dkjson.decode(characterJSON)
	local charData = build.importTab:ImportItemsAndSkills(input)
	build.importTab:ImportPassiveTreeAndJewels(input)
	-- You now have a build without a correct main skill selected, or any configuration options set
	-- Good luck!
end

-- API server integration (env-gated)
-- Set POB_API_STDIO=1 to start the stdio JSON-RPC server and exit
if os.getenv('POB_API_STDIO') == '1' then
  dofile('API/Server.lua')
  return
end
