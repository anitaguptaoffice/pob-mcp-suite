-- API/Handlers.lua
-- Shared JSON-RPC handlers for PoB API (transport-agnostic)

-- Debug logging control
local DEBUG = os.getenv('POB_API_DEBUG') == '1'
local function debug_log(msg)
  if DEBUG then io.stderr:write('[Handlers] ' .. msg .. '\n') end
end

-- Resolve BuildOps reliably regardless of CWD
local BuildOps
do
  debug_log('Attempting to require API.BuildOps')
  local ok_ops, mod = pcall(require, 'API.BuildOps')
  debug_log('pcall require result: ok=' .. tostring(ok_ops) .. ', mod=' .. tostring(mod))
  if ok_ops and mod then
    debug_log('Successfully loaded BuildOps via require')
    BuildOps = mod
  else
    debug_log('require failed, trying dofile fallbacks')
    -- Try path relative to this file's directory
    local dir = ''
    local info = debug and debug.getinfo and debug.getinfo(1, 'S')
    local src = info and info.source or ''
    if type(src) == 'string' and src:sub(1,1) == '@' then
      local p = src:sub(2)
      dir = (p:gsub('[^/\\]+$', ''))
    end
    local tried = {}
    local function try(p)
      if p then table.insert(tried, p) end
      if not p then return false end
      debug_log('Trying to load: ' .. tostring(p))
      local ok2, m = pcall(dofile, p)
      if ok2 and m then
        debug_log('Successfully loaded BuildOps from: ' .. tostring(p))
        BuildOps = m
        return true
      end
      debug_log('Failed to load from: ' .. tostring(p) .. ' - error: ' .. tostring(m))
      return false
    end
    if not BuildOps then
      local _ = try(dir .. 'BuildOps.lua')
              or try((rawget(_G,'POB_SCRIPT_DIR') or '.') .. '/API/BuildOps.lua')
              or try('API/BuildOps.lua')
              or try('src/API/BuildOps.lua')
    end
    if not BuildOps then
      io.stderr:write('[Handlers] BuildOps.lua not found. Tried paths: ' .. table.concat(tried, ', ') .. '\n')
      error('API/BuildOps.lua not found. Tried: ' .. table.concat(tried, ', '))
    end
  end
end

-- API version (semantic versioning)
local API_VERSION = "1.0.0"

local function version_meta()
  return {
    number      = _G.launch and launch.versionNumber or '?',
    branch      = _G.launch and launch.versionBranch or '?',
    platform    = _G.launch and launch.versionPlatform or '?',
    apiVersion  = API_VERSION,
  }
end

local handlers = {}

handlers.ping = function(params)
  return { ok = true, pong = true }
end

handlers.version = function(params)
  return { ok = true, version = version_meta() }
end

handlers.new_build = function(params)
  if not _G.newBuild then
    return { ok = false, error = 'headless wrapper not initialized' }
  end
  _G.newBuild()
  return { ok = true }
end

handlers.load_build_xml = function(params)
  if not params or type(params.xml) ~= 'string' then
    return { ok = false, error = 'missing xml' }
  end
  local name = (params.name and tostring(params.name)) or 'API Build'
  if not _G.loadBuildFromXML then
    return { ok = false, error = 'headless wrapper not initialized' }
  end
  _G.loadBuildFromXML(params.xml, name)
  return { ok = true, build_id = 1 }
end

handlers.get_stats = function(params)
  local fields = params and params.fields or nil
  local stats, err = BuildOps.export_stats(fields)
  if not stats then
    return { ok = false, error = err }
  end
  return { ok = true, stats = stats }
end

handlers.get_items = function(params)
  local list, err = BuildOps.get_items()
  if not list then return { ok = false, error = err } end
  return { ok = true, items = list }
end

handlers.get_skills = function(params)
  local info, err = BuildOps.get_skills()
  if not info then return { ok = false, error = err } end
  return { ok = true, skills = info }
end

handlers.get_tree = function(params)
  local tree, err = BuildOps.get_tree()
  if not tree then
    return { ok = false, error = err }
  end
  return { ok = true, tree = tree }
end

handlers.set_main_selection = function(params)
  local ok2, err = BuildOps.set_main_selection(params or {})
  if not ok2 then return { ok = false, error = err } end
  local skills = BuildOps.get_skills()
  return { ok = true, skills = skills }
end

handlers.set_tree = function(params)
  local ok2, err = BuildOps.set_tree(params or {})
  if not ok2 then
    return { ok = false, error = err }
  end
  local tree = BuildOps.get_tree()
  return { ok = true, tree = tree }
end

handlers.add_item_text = function(params)
  local res, err = BuildOps.add_item_text(params or {})
  if not res then return { ok = false, error = err } end
  return { ok = true, item = res }
end

handlers.export_build_xml = function(params)
  local xml, err = BuildOps.export_build_xml()
  if not xml then return { ok = false, error = err } end
  return { ok = true, xml = xml }
end

handlers.set_level = function(params)
  if not params or params.level == nil then
    return { ok = false, error = 'missing level' }
  end
  local ok2, err = BuildOps.set_level(params.level)
  if not ok2 then return { ok = false, error = err } end
  return { ok = true }
end

handlers.set_flask_active = function(params)
  local ok2, err = BuildOps.set_flask_active(params or {})
  if not ok2 then return { ok = false, error = err } end
  return { ok = true }
end

handlers.get_build_info = function(params)
  local info, err = BuildOps.get_build_info()
  if not info then return { ok = false, error = err } end
  return { ok = true, info = info }
end

handlers.update_tree_delta = function(params)
  local ok2, err = BuildOps.update_tree_delta(params or {})
  if not ok2 then return { ok = false, error = err } end
  local tree = BuildOps.get_tree()
  return { ok = true, tree = tree }
end

handlers.calc_with = function(params)
  local out, base = BuildOps.calc_with(params or {})
  if not out then return { ok = false, error = base } end
  return { ok = true, output = out }
end

handlers.get_config = function(params)
  local cfg, err = BuildOps.get_config()
  if not cfg then return { ok = false, error = err } end
  return { ok = true, config = cfg }
end

handlers.set_config = function(params)
  local ok2, err = BuildOps.set_config(params or {})
  if not ok2 then return { ok = false, error = err } end
  local cfg = BuildOps.get_config()
  return { ok = true, config = cfg }
end

handlers.create_socket_group = function(params)
  local res, err = BuildOps.create_socket_group(params or {})
  if not res then return { ok = false, error = err or 'failed to create socket group' } end
  return { ok = true, socketGroup = res }
end

handlers.add_gem = function(params)
  local res, err = BuildOps.add_gem(params or {})
  if not res then return { ok = false, error = err or 'failed to add gem' } end
  return { ok = true, gem = res }
end

handlers.set_gem_level = function(params)
  local ok2, err = BuildOps.set_gem_level(params or {})
  if not ok2 then return { ok = false, error = err or 'failed to set gem level' } end
  return { ok = true }
end

handlers.set_gem_quality = function(params)
  local ok2, err = BuildOps.set_gem_quality(params or {})
  if not ok2 then return { ok = false, error = err or 'failed to set gem quality' } end
  return { ok = true }
end

handlers.remove_skill = function(params)
  local ok2, err = BuildOps.remove_skill(params or {})
  if not ok2 then return { ok = false, error = err or 'failed to remove skill' } end
  return { ok = true }
end

handlers.remove_gem = function(params)
  local ok2, err = BuildOps.remove_gem(params or {})
  if not ok2 then return { ok = false, error = err or 'failed to remove gem' } end
  return { ok = true }
end

handlers.search_nodes = function(params)
  local res, err = BuildOps.search_nodes(params or {})
  if not res then return { ok = false, error = err or 'failed to search nodes' } end
  return { ok = true, results = res }
end

-- Enumerate Timeless Jewel seeds using PoB's authoritative LUT.  This is kept
-- in the headless API so MCP clients never need to ship or decode the LUT.
handlers.find_timeless_jewel_seeds = function(params)
	params = params or {}
	local socketId = tonumber(params.socketNodeId)
	local desired = params.desired or {}
	local limit = math.min(tonumber(params.limit) or 20, 100)
	if not socketId then return { ok = false, error = 'missing socketNodeId' } end
	if not build or not build.spec or not build.spec.tree then return { ok = false, error = 'no build loaded' } end
	local tree = build.spec.tree
	local socket = tree.nodes[socketId]
	if not socket or not socket.nodesInRadius or not socket.nodesInRadius[3] then
		return { ok = false, error = 'invalid timeless jewel socket' }
	end
	local wanted = {}
	for _, entry in ipairs(desired) do wanted[entry] = true end
	if not next(wanted) then return { ok = false, error = 'desired must contain one or more PoB legion node ids' } end
	local staticHits, staticScore = {}, 0
	-- Elegant Hubris keystones are selected by the historic figure, rather than
	-- by the seed LUT. Caspiro always converts a Keystone in radius to Supreme
	-- Ostentation; the caller supplies the particular original Keystone they use.
	if params.historicFigure == 'Caspiro' and wanted['eternal_keystone_3_v2'] and params.keystoneNodeId then
		local keyNode = tree.nodes[tonumber(params.keystoneNodeId)]
		if keyNode then
			table.insert(staticHits, { nodeId = tonumber(params.keystoneNodeId), nodeName = keyNode.dn, id = 'eternal_keystone_3_v2', name = 'Supreme Ostentation', stats = { 'Ignore Attribute Requirements', 'Gain no inherent bonuses from Attributes' }, static = true })
			staticScore = 1
		end
	end
	local seeds = params.seeds
	if seeds and type(seeds) ~= 'table' then return { ok = false, error = 'seeds must be an array when provided' } end
	local requiredNodes = {}
	for _, nodeId in ipairs(params.requiredSourceNodeIds or {}) do requiredNodes[tonumber(nodeId)] = true end
	local requireSpecificNode = next(requiredNodes) ~= nil
	local results = {}
	local function scanSeed(seed)
		local hits, score, dynamicScore, matchedRequiredNode = {}, staticScore, 0, false
		for _, hit in ipairs(staticHits) do table.insert(hits, hit) end
		for nodeId in pairs(socket.nodesInRadius[3]) do
			local node = tree.nodes[nodeId]
			-- Elegant Hubris's LUT covers notables only. Its Keystone is set by
			-- the historic figure (Caspiro => Supreme Ostentation), not the seed.
			if node and node.type == 'Notable' then
				local lut = data.readLUT(seed, nodeId, 5)
				local candidate = nil
				if lut[1] and lut[1] >= data.timelessJewelAdditions then
					candidate = tree.legion.nodes[lut[1] + 1 - data.timelessJewelAdditions]
				elseif lut[1] then
					candidate = tree.legion.additions[lut[1] + 1]
				end
				if candidate and wanted[candidate.id] then
					score = score + 1
					dynamicScore = dynamicScore + 1
					if requiredNodes[nodeId] then matchedRequiredNode = true end
					table.insert(hits, { nodeId = nodeId, nodeName = node.dn, id = candidate.id, name = candidate.dn, stats = candidate.sd })
				end
			end
		end
		-- A historic figure's Keystone is shared by every seed; retain only seeds
		-- that additionally hit at least one seed-dependent desired notable.
		if dynamicScore > 0 and (not requireSpecificNode or matchedRequiredNode) then table.insert(results, { seed = seed, score = score, hits = hits }) end
	end
	if seeds then
		for _, seed in ipairs(seeds) do scanSeed(tonumber(seed)) end
	else
		for seed = data.timelessJewelSeedMin[5] * 20, data.timelessJewelSeedMax[5] * 20, 20 do scanSeed(seed) end
	end
	table.sort(results, function(a,b) return a.score > b.score or (a.score == b.score and a.seed < b.seed) end)
	while #results > limit do table.remove(results) end
	return { ok = true, socketNodeId = socketId, jewelType = 'Elegant Hubris', results = results }
end

return {
  handlers = handlers,
  version_meta = version_meta,
}
