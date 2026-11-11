-- JSON-lines adapter for an unmodified PathOfBuildingCommunity checkout.
-- Run with cwd set to its src/ directory: luajit /path/to/vanilla_stdio_bridge.lua
-- All build operations live in pob_ops.lua (repo-owned); no PoB patches required.
local json = require('dkjson')

-- Locate this script's directory so repo-owned modules load regardless of cwd
local ADAPTER_DIR = (arg and arg[0] or ''):gsub('[^/\\]*$', '')
if ADAPTER_DIR == '' then ADAPTER_DIR = './' end

-- Stock HeadlessWrapper does not define this render stub; define it before the
-- dofile so an upstream version, if one is ever added, takes precedence.
if not GetVirtualScreenSize then
  function GetVirtualScreenSize() return 1920, 1080 end
end

-- The upstream wrapper initializes PoB and exposes newBuild/loadBuildFromXML plus `build`.
dofile('HeadlessWrapper.lua')

-- HeadlessWrapper stubs Inflate() to return "", which makes PoB's timeless jewel
-- loader overwrite its .bin cache with an empty file and skip conquered nodes.
-- Provide a real implementation via the system zlib (LuaJIT FFI).
do
  local ok, err = pcall(function()
    local ffi = require('ffi')
    ffi.cdef[[
      int uncompress(uint8_t *dest, unsigned long *destLen, const uint8_t *source, unsigned long sourceLen);
    ]]
    local zlib
    for _, name in ipairs({ 'z', 'libz.so.1', 'libz.dylib', 'zlib1' }) do
      local loaded, lib = pcall(ffi.load, name)
      if loaded then zlib = lib break end
    end
    if not zlib then error('zlib not found') end
    function Inflate(data)
      if not data or #data == 0 then return '' end
      local size = math.max(#data * 4, 65536)
      while size <= 1024 * 1024 * 1024 do
        local buf = ffi.new('uint8_t[?]', size)
        local len = ffi.new('unsigned long[1]', size)
        local rc = zlib.uncompress(buf, len, data, #data)
        if rc == 0 then return ffi.string(buf, len[0]) end
        if rc ~= -5 then return '' end -- Z_BUF_ERROR means grow and retry
        size = size * 2
      end
      return ''
    end
  end)
  if not ok then
    io.stderr:write('vanilla_stdio_bridge: real Inflate unavailable (' .. tostring(err) .. '); timeless jewels will not be calculated\n')
  end
end

local BuildOps = dofile(ADAPTER_DIR .. 'pob_ops.lua')

-- json.encode raises on cycles, NaN and functions. An uncaught raise here kills
-- the process and takes the caller's loaded build with it, so a payload we
-- cannot serialise must degrade into an error response, never a crash.
local function reply(value)
  local ok, encoded = pcall(json.encode, value)
  if not ok then
    encoded = json.encode({
      ok = false,
      error = 'response could not be serialised: ' .. tostring(encoded),
    })
  end
  io.write(encoded, '\n')
  io.flush()
end

-- Class name → classId mapping (PoE1)
local CLASS_IDS = {
  Scion=0, Marauder=1, Ranger=2, Witch=3, Duelist=4, Templar=5, Shadow=6,
  scion=0, marauder=1, ranger=2, witch=3, duelist=4, templar=5, shadow=6,
}
-- Evaluate upstream PoB's native anoint simulation without altering the loaded build.
-- This follows NotableDBControl's MiscCalculator approach, while restoring the UI
-- selection even if a candidate calculation fails.
local function evaluate_anoint_candidates(params)
  if not build or not build.itemsTab or not build.spec or not build.spec.tree then return { ok = false, error = 'build not initialized' } end
  local slotName = params.slot
  if type(slotName) ~= 'string' or slotName == '' then return { ok = false, error = 'slot is required (for example, Amulet)' } end
  local control = build.itemsTab.slots and build.itemsTab.slots[slotName]
  local item = control and control.selItemId and build.itemsTab.items[control.selItemId] or nil
  if not item then return { ok = false, error = 'no equipped item in ' .. slotName } end
  if slotName ~= 'Amulet' and not item.canBeAnointed then return { ok = false, error = slotName .. ' is not an anointable item slot' } end

  local tab, previousItem, previousEnchantSlot = build.itemsTab, build.itemsTab.displayItem, build.itemsTab.anointEnchantSlot
  -- PoB's misc calculator can refresh item-slot UI visibility as a side effect.
  -- Restore these flags even when a candidate fails, along with the display item.
  local previousSlotStates = {}
  for _, slot in pairs(tab.slots or {}) do table.insert(previousSlotStates, { slot = slot, inactive = slot.inactive }) end
  local ok, result = pcall(function()
    tab:SetDisplayItem(item)
    local enchantSlot = params.enchantSlot or 1
    if type(enchantSlot) ~= 'number' or enchantSlot ~= math.floor(enchantSlot) or enchantSlot < 1 or enchantSlot > 3 or enchantSlot > #(item.enchantModLines or {}) + 1 then error('invalid enchant slot') end
    local selectedEnchant = item.enchantModLines and item.enchantModLines[enchantSlot] and item.enchantModLines[enchantSlot].line or nil
    tab.anointEnchantSlot = enchantSlot
    local calc = build.calcsTab:GetMiscCalculator()
    local repSlotName = item.base and item.base.type or slotName
    local base = calc({ repSlotName = repSlotName, repItem = tab:anointItem(nil) })
    local focus = params.focus or 'both'
    if focus ~= 'dps' and focus ~= 'defence' and focus ~= 'both' then error('invalid anoint focus') end
    local function number(value)
      value = tonumber(value)
      if not value or value ~= value or value == math.huge or value == -math.huge then return nil end
      return value
    end
    local damageStat, baseDps
    for _, candidate in ipairs({
      { 'CombinedDPS', base.CombinedDPS }, { 'TotalDPS', base.TotalDPS },
      { 'MinionCombinedDPS', base.Minion and base.Minion.CombinedDPS },
      { 'MinionTotalDPS', base.Minion and base.Minion.TotalDPS },
    }) do
      local value = number(candidate[2])
      if value and value > 0 and (not params.damageMetric or params.damageMetric == candidate[1]) then damageStat, baseDps = candidate[1], value; break end
    end
    if params.damageMetric and params.damageMetric ~= 'CombinedDPS' and params.damageMetric ~= 'TotalDPS' and params.damageMetric ~= 'MinionCombinedDPS' and params.damageMetric ~= 'MinionTotalDPS' then error('invalid damage metric') end
    local baseEhp = number(base.TotalEHP)
    if focus ~= 'defence' and not baseDps then error('no positive damage baseline for anoint evaluation') end
    if focus ~= 'dps' and (not baseEhp or baseEhp <= 0) then error('no positive effective hit pool baseline for anoint evaluation') end
    local function damage(output)
      if damageStat == 'MinionCombinedDPS' then return number(output.Minion and output.Minion.CombinedDPS) end
      if damageStat == 'MinionTotalDPS' then return number(output.Minion and output.Minion.TotalDPS) end
      return damageStat and number(output[damageStat]) or nil
    end
    local candidates, evaluated, skipped = {}, 0, 0
    for id, node in pairs(build.spec.tree.nodes or {}) do
      if node.recipe and node.dn and node.modKey ~= '' and not build.spec.allocNodes[id] then
        local candidateOk, output = pcall(calc, { repSlotName = repSlotName, repItem = tab:anointItem(node) })
        local candidateDps = candidateOk and output and damage(output) or nil
        local candidateEhp = candidateOk and output and number(output.TotalEHP) or nil
        if candidateOk and output and (focus == 'defence' or candidateDps ~= nil) and (focus == 'dps' or candidateEhp ~= nil) then
          local dps = candidateDps and baseDps and candidateDps - baseDps or 0
          local ehp = candidateEhp and baseEhp and candidateEhp - baseEhp or 0
          local score = focus == 'dps' and dps or (focus == 'defence' and ehp or (dps / baseDps + 0.5 * ehp / baseEhp))
          local recipe = {}; for _, oil in ipairs(node.recipe or {}) do table.insert(recipe, tostring(oil)) end
          table.insert(candidates, { nodeId = tonumber(id) or id, name = node.dn, dpsDelta = dps, ehpDelta = ehp, score = score, recipe = recipe })
          evaluated = evaluated + 1
        else skipped = skipped + 1 end
      end
    end
    table.sort(candidates, function(a, b) return a.score > b.score end)
    local limit = math.min(math.max(tonumber(params.limit) or 50, 1), 500)
    while #candidates > limit do table.remove(candidates) end
    return { ok = true, candidates = candidates, base = { CombinedDPS = number(base.CombinedDPS) or 0, TotalEHP = baseEhp or 0, damageStat = damageStat, damageValue = baseDps, ehpAvailable = baseEhp ~= nil }, evaluated = evaluated, skipped = skipped, slot = slotName, enchantSlot = enchantSlot, selectedEnchant = selectedEnchant, baseType = item.baseName or repSlotName, focus = focus }
  end)
  local restored, restoreError = pcall(tab.SetDisplayItem, tab, previousItem)
  tab.anointEnchantSlot = previousEnchantSlot
  for _, state in ipairs(previousSlotStates) do state.slot.inactive = state.inactive end
  if not restored then return { ok = false, error = 'anoint display restoration failed: ' .. tostring(restoreError) } end
  if not ok then return { ok = false, error = 'anoint evaluation failed: ' .. tostring(result) } end
  return result
end

-- Drive upstream TradeQueryGenerator directly, avoiding its interactive dialog.
-- The generator is a normal PoB class; its coroutine is advanced synchronously
-- here and the generated JSON is returned to Node for the actual Trade API call.
local function generate_weighted_trade_query(params)
  if not build or not build.itemsTab or not build.itemsTab.tradeQuery then return { ok = false, error = 'build/items not initialized' } end
  local slotName = params.slot
  local slot = type(slotName) == 'string' and build.itemsTab.slots and build.itemsTab.slots[slotName] or nil
  if not slot then return { ok = false, error = 'unknown equipment slot: ' .. tostring(slotName) } end
  local options = params.options or {}
  options.includeMirrored = options.includeMirrored == true
  options.includeCorrupted = options.includeCorrupted ~= false
  options.includeScourge = options.includeScourge == true
  options.includeEldritch = options.includeEldritch == true
  options.influence1 = tonumber(options.influence1) or 1
  options.influence2 = tonumber(options.influence2) or 1
  options.jewelType = options.jewelType or 'Any'
  options.statWeights = options.statWeights or build.itemsTab.tradeQuery.statSortSelectionList
  if not options.statWeights or #options.statWeights == 0 then options.statWeights = { { label = 'Full DPS', stat = 'FullDPS', weightMult = 1.0 }, { label = 'Effective Hit Pool', stat = 'TotalEHP', weightMult = 0.5 } } end
  local ok, result = pcall(function()
    local weightBaselines
    if params.reportWeightBaselines then
      local _, baseOutput = build.calcsTab:GetMiscCalculator()
      if type(baseOutput) ~= 'table' then error('PoB weighted baseline unavailable') end
      weightBaselines = setmetatable({}, { __jsontype = 'array' })
      for _, entry in ipairs(options.statWeights) do
        if type(entry.stat) ~= 'string' then error('invalid weighted stat') end
        local value, method
        if entry.stat == 'FullDPS' and baseOutput.FullDPS == nil then
          value = data.powerStatList.GetFromOutput(baseOutput, { stat = 'TotalDPS' }, true) + data.powerStatList.GetFromOutput(baseOutput, { stat = 'TotalDotDPS' }, true) + data.powerStatList.GetFromOutput(baseOutput, { stat = 'CombinedDPS' }, true)
          method = 'full_dps_fallback_sum'
        else
          value = data.powerStatList.GetFromOutput(baseOutput, entry, true)
          method = 'pob_power_stat'
        end
        if type(value) ~= 'number' or value ~= value or value == math.huge or value == -math.huge or value <= 0 then error('weighted baseline unavailable or nonpositive for ' .. entry.stat) end
        table.insert(weightBaselines, { stat = entry.stat, value = value, method = method })
      end
    end
    local generator = new('TradeQueryGenerator'):TradeQueryGenerator(build.itemsTab.tradeQuery)
    local query, warning
    generator.requesterCallback = function(_, generated, err) query, warning = generated, err end
    generator.requesterContext = {}
    generator.tradeTypeIndex = 1 -- upstream currently maps index 1 to securable
    generator:StartQuery(slot, options)
    local frames = 0
    while generator.calcContext and generator.calcContext.co and frames < 100000 do generator:OnFrame(); frames = frames + 1 end
    if generator.calcContext and generator.calcContext.co then error('TradeQueryGenerator did not complete after 100000 frames') end
    if not query then error(warning or 'PoB generated no trade query') end
    -- Newer PoB returns the inner query table; the Trade API expects the
    -- outer query/sort envelope used by earlier versions.
    if type(query) == 'table' and not query.query and query.stats then
      query = { query = query, sort = { price = 'asc' } }
    end
    return { ok = true, query = query, warning = warning, frames = frames, weightBaselines = weightBaselines }
  end)
  if not ok then return { ok = false, error = 'weighted trade query failed: ' .. tostring(result) } end
  return result
end

-- Wrap a BuildOps function that returns (result, err) into the JSON envelope.
-- resultKey names the field the TS bridge reads the payload from.
local function op(fn, resultKey)
  return function(params)
    local res, err = fn(params or {})
    if res == nil then return { ok = false, error = err or 'operation failed' } end
    local envelope = { ok = true }
    if resultKey then envelope[resultKey] = res end
    return envelope
  end
end

local handlers = {}

handlers.ping = function() return { ok = true, pong = true } end

handlers.version = function()
  return { ok = true, version = {
    number = _G.launch and launch.versionNumber or '?',
    branch = _G.launch and launch.versionBranch or '?',
    platform = _G.launch and launch.versionPlatform or '?',
    adapter = 'vanilla-stdio-v2',
  } }
end

handlers.new_build = function(params)
  if not _G.newBuild then return { ok = false, error = 'headless wrapper not initialized' } end
  _G.newBuild()
  if params and (params.className or params.ascendancy) then
    local classId = params.className and (CLASS_IDS[params.className] or CLASS_IDS[params.className:lower()]) or 0
    if params.className and not CLASS_IDS[params.className] and not CLASS_IDS[params.className:lower()] then
      return { ok = false, error = 'unknown class: ' .. tostring(params.className) }
    end
    if params.treeVersion then
      if type(params.treeVersion) ~= 'string' or not params.treeVersion:match('^%d+_%d+[%w_]*$') or #params.treeVersion > 60 then
        return { ok = false, error = 'invalid tree version' }
      end
      BuildOps.import_from_node_list(build.spec, classId, 0, 0, {}, {}, {}, params.treeVersion)
      if build.spec.treeVersion ~= params.treeVersion then return { ok = false, error = 'tree version was not applied' } end
    end
    local ascendId = 0
    if params.ascendancy and params.ascendancy:lower() ~= 'none' then
      local class = build and build.spec and build.spec.tree and build.spec.tree.classes[classId]
      for id, entry in pairs(class and class.classes or {}) do
        if id ~= 0 and type(entry.name) == 'string' and entry.name:lower() == params.ascendancy:lower() then
          ascendId = id
          break
        end
      end
      if ascendId == 0 then return { ok = false, error = 'unknown ascendancy for this tree: ' .. tostring(params.ascendancy) } end
    end
    if build and build.spec then
      BuildOps.import_from_node_list(build.spec, classId, ascendId, 0, {}, {}, {}, nil)
    end
  end
  return { ok = true }
end

handlers.load_build_xml = function(params)
  if not params or type(params.xml) ~= 'string' then return { ok = false, error = 'missing xml' } end
  if not _G.loadBuildFromXML then return { ok = false, error = 'headless wrapper not initialized' } end
  local ok, err = pcall(_G.loadBuildFromXML, params.xml, (params.name and tostring(params.name)) or 'API Build')
  if not ok then return { ok = false, error = tostring(err) } end
  -- PoB can close the build or stop at a conversion popup without throwing.
  -- Shutdown clears savers, so stale build fields alone do not prove a load.
  if not build or not build.savers or not build.spec then
    return { ok = false, error = 'PoB did not initialize the build; check the XML and supported build version' }
  end
  return { ok = true, build_id = 1 }
end

handlers.get_stats = function(params)
  local stats, err = BuildOps.export_stats(params and params.fields or nil)
  if not stats then return { ok = false, error = err } end
  return { ok = true, stats = stats }
end

handlers.set_tree = function(params)
  local ok2, err = BuildOps.set_tree(params or {})
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, tree = (BuildOps.get_tree()) }
end

handlers.set_tree_guarded = function(params)
  params = params or {}
  params.rejectIfOverrides = true
  local ok2, err = BuildOps.set_tree(params)
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, tree = (BuildOps.get_tree()) }
end

handlers.set_tree_preserve_overrides = function(params)
  params = params or {}
  params.preserveOverrides = true
  local ok2, err = BuildOps.set_tree(params)
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, tree = (BuildOps.get_tree()) }
end
handlers.get_tree_overrides = op(BuildOps.get_tree_overrides, 'overrides')

handlers.update_tree_delta = function(params)
  local result, err = BuildOps.update_tree_delta(params or {})
  if not result then return { ok = false, error = err } end
  return { ok = true, tree = result.tree, droppedNodes = result.droppedNodes }
end

handlers.set_config = function(params)
  local result, err = BuildOps.set_config(params or {})
  if not result then return { ok = false, error = err } end
  -- Report per-key outcomes so the caller can tell an applied change from a
  -- rejected one instead of assuming success.
  return {
    ok = true,
    applied = result.applied,
    rejected = result.rejected,
    config = (BuildOps.get_config()),
  }
end

handlers.set_main_selection = function(params)
  local ok2, err = BuildOps.set_main_selection(params or {})
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, skills = (BuildOps.get_skills()) }
end

handlers.set_calcs_selection = function(params)
  local ok2, err = BuildOps.set_calcs_selection(params or {})
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, skills = (BuildOps.get_skills()) }
end

handlers.set_level = function(params)
  if not params or params.level == nil then return { ok = false, error = 'missing level' } end
  local ok2, err = BuildOps.set_level(params.level)
  if not ok2 then return { ok = false, error = err } end
  return { ok = true }
end

handlers.set_flask_active = op(BuildOps.set_flask_active)
handlers.set_gem_level = op(BuildOps.set_gem_level)
handlers.set_gem_quality = op(BuildOps.set_gem_quality)
handlers.set_gem_enabled = op(BuildOps.set_gem_enabled)
handlers.remove_skill = op(BuildOps.remove_skill)
handlers.remove_gem = op(BuildOps.remove_gem)

handlers.get_tree = op(BuildOps.get_tree, 'tree')
handlers.get_cluster_jewels = op(BuildOps.get_cluster_jewels, 'result')
handlers.inspect_item_parse = op(BuildOps.inspect_item_parse, 'result')
handlers.get_items = op(BuildOps.get_items, 'items')
handlers.get_item_inventory = op(BuildOps.get_item_inventory, 'items')
handlers.get_skills = op(BuildOps.get_skills, 'skills')
handlers.get_cost_snapshot = function()
  local skills, skillErr = BuildOps.get_skills()
  if not skills then return { ok = false, error = skillErr or 'skills unavailable' } end
  local items, itemErr = BuildOps.get_items()
  if not items then return { ok = false, error = itemErr or 'equipment unavailable' } end
  return { ok = true, result = { items = items, skills = skills } }
end
handlers.get_compatible_supports = op(BuildOps.get_compatible_supports, 'result')
handlers.get_build_info = op(BuildOps.get_build_info, 'info')
handlers.get_build_notes = op(BuildOps.get_build_notes, 'notes')
handlers.set_build_notes = op(BuildOps.set_build_notes)
handlers.get_config = function()
  local cfg, err = BuildOps.get_config()
  if cfg == nil then return { ok = false, error = err or 'operation failed' } end
  return { ok = true, config = cfg, labels = (BuildOps.get_config_labels()), enemyLevelSetting = (BuildOps.get_enemy_level_setting()) }
end
handlers.calc_with = op(BuildOps.calc_with, 'output')
handlers.compare_item = op(BuildOps.compare_item, 'result')
handlers.item_comparison_snapshot = op(BuildOps.item_comparison_snapshot, 'result')
handlers.unchanged_items_snapshot = op(BuildOps.unchanged_items_snapshot, 'result')
handlers.get_item_affix_weight = op(BuildOps.get_item_affix_weight, 'result')
handlers.export_build_xml = op(BuildOps.export_build_xml, 'xml')
handlers.add_item_text = op(BuildOps.add_item_text, 'item')
handlers.create_socket_group = op(BuildOps.create_socket_group, 'socketGroup')
handlers.add_gem = op(BuildOps.add_gem, 'gem')
handlers.search_nodes = op(BuildOps.search_nodes, 'results')
handlers.query_tree_paths = op(dofile(ADAPTER_DIR .. 'tree_paths.lua'), 'result')
handlers.get_mastery_options = op(BuildOps.get_mastery_options, 'result')
handlers.get_mastery_node_options = op(BuildOps.get_mastery_node_options, 'result')
handlers.refresh_tree_progress = op(BuildOps.refresh_tree_progress)
handlers.get_ailments = op(BuildOps.get_ailments, 'result')
handlers.save_build = op(BuildOps.save_build, 'result')
handlers.list_specs = op(BuildOps.list_specs, 'result')
handlers.select_spec = op(BuildOps.select_spec, 'result')
handlers.create_spec = op(BuildOps.create_spec, 'result')
handlers.delete_spec = op(BuildOps.delete_spec, 'result')
handlers.rename_spec = op(BuildOps.rename_spec, 'result')
handlers.list_item_sets = op(BuildOps.list_item_sets, 'result')
handlers.select_item_set = op(BuildOps.select_item_set, 'result')
handlers.set_socket_group_enabled = op(BuildOps.set_socket_group_enabled, 'result')

handlers.evaluate_anoint_candidates = evaluate_anoint_candidates
handlers.generate_weighted_trade_query = generate_weighted_trade_query
handlers.generate_weighted_trade_query_v2 = function(params)
  params = params or {}
  params.reportWeightBaselines = true
  return generate_weighted_trade_query(params)
end

handlers.find_timeless_jewel_seeds = dofile(ADAPTER_DIR .. 'timeless_jewel.lua')

handlers.get_capabilities = function()
  local actions = { 'quit' }
  for name in pairs(handlers) do table.insert(actions, name) end
  table.sort(actions)
  return { ok = true, capabilities = { mode = 'vanilla', adapter = 'vanilla-stdio-v2', actions = actions } }
end

reply({ ok = true, ready = true, version = { adapter = 'vanilla-stdio-v2' } })
for line in io.lines() do
  local request = json.decode(line)
  -- dkjson happily decodes scalars ("5", "\"ping\""); indexing them would
  -- raise OUTSIDE the handler pcall and kill the bridge — the one failure
  -- mode reply() promises to prevent.
  if type(request) ~= 'table' then
    reply({ ok = false, error = 'invalid request: expected a JSON object' })
  else
    local action, params = request.action, request.params or {}
    if action == 'quit' then
      reply({ ok = true, quit = true })
      break
    end
    local handler = handlers[action]
    if not handler then
      reply({ ok = false, error = 'unknown action: ' .. tostring(action) })
    else
      local ok, res = pcall(handler, params)
      if not ok then
        reply({ ok = false, error = tostring(res) })
      elseif type(res) ~= 'table' then
        reply({ ok = false, error = 'handler returned no response' })
      else
        reply(res)
      end
    end
  end
end
