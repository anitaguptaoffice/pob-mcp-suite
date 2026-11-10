-- Thin wrappers around PoB headless objects for programmatic operations

local M = {}

-- PoB's own config option table is the only authoritative list of valid config
-- vars and their types. Deriving from it means new upstream options work here
-- without a code change; a hand-maintained allowlist silently drifts instead.
local configVarIndex
local function getConfigVarIndex()
  if configVarIndex then return configVarIndex end
  local ok, varList = pcall(LoadModule, "Modules/ConfigOptions")
  if not ok or type(varList) ~= 'table' then return nil end
  configVarIndex = {}
  for _, varData in ipairs(varList) do
    if varData.var then
      configVarIndex[varData.var] = varData
    end
  end
  return configVarIndex
end

-- Coerce an incoming JSON value to what PoB's control for this var would store.
-- Returns value, err.
local function coerceConfigValue(varData, value)
  local t = varData.type
  if t == 'check' then
    if type(value) == 'boolean' then return value end
    if value == 'true' or value == 1 then return true end
    if value == 'false' or value == 0 then return false end
    return nil, 'expected boolean'
  elseif t == 'count' or t == 'countAllowZero' or t == 'integer' or t == 'float' then
    local n = tonumber(value)
    if not n then return nil, 'expected number' end
    return n
  elseif t == 'list' then
    -- Accept either the stored val or the human-facing label.
    for _, entry in ipairs(varData.list or {}) do
      if entry.val == value or tostring(entry.val) == tostring(value) then return entry.val end
      if entry.label and tostring(entry.label):lower() == tostring(value):lower() then return entry.val end
    end
    return nil, 'not a valid option for this list'
  end
  -- Unknown control type: store as-is rather than refusing.
  return value
end

-- Human-facing label for a stored config value, so callers see "Kill all"
-- rather than the raw "None" that PoB stores for the bandit quest.
function M.config_value_label(var, value)
  local index = getConfigVarIndex()
  local varData = index and index[var]
  if not varData or varData.type ~= 'list' then return nil end
  for _, entry in ipairs(varData.list or {}) do
    if entry.val == value or tostring(entry.val) == tostring(value) then return entry.label end
  end
  return nil
end

-- Upstream's PassiveSpec:ImportFromNodeList gained a leading className
-- parameter (9 params incl. self, up from 8). Detect which signature the
-- loaded checkout has so both old and current PoB versions work.
--
-- ImportFromNodeList also refuses to allocate a Mastery node that has no
-- effect selected in the `mastery` table, silently dropping it instead. Every
-- tree-mutation entry point (set_tree, update_tree_delta) funnels through
-- here, so the merge lives at this chokepoint: the spec's current selections
-- are merged underneath whatever the caller supplies, and caller-supplied
-- ids/effects are coerced to numbers. That way the invariant holds for every
-- caller, present and future, instead of each one having to re-implement it.
function M.import_from_node_list(spec, classId, ascendId, secondaryId, nodes, overrides, mastery, treeVersion)
  -- A tree reload replaces node objects before PoB resets the previous
  -- ascendancy. Clear it while its original start node still exists.
  if treeVersion and treeVersion ~= spec.treeVersion and (spec.curAscendClassId or 0) ~= 0 then
    spec:SelectAscendClass(0)
  end
  local mergedMastery = {}
  for k, v in pairs(spec.masterySelections or {}) do mergedMastery[k] = v end
  if type(mastery) == 'table' then
    for nodeId, effectId in pairs(mastery) do
      mergedMastery[tonumber(nodeId) or nodeId] = tonumber(effectId) or effectId
    end
  end

  local info = debug and debug.getinfo and debug.getinfo(spec.ImportFromNodeList, 'u')
  if info and info.nparams and info.nparams >= 9 then
    return spec:ImportFromNodeList(nil, classId, ascendId, secondaryId, nodes, overrides or {}, mergedMastery, treeVersion)
  end
  return spec:ImportFromNodeList(classId, ascendId, secondaryId, nodes, overrides or {}, mergedMastery, treeVersion)
end

local MIN_PLAYER_LEVEL = 1
local MAX_PLAYER_LEVEL = 100
local NUM_FLASK_SLOTS = 5
local MAX_ITEM_TEXT_LENGTH = 10240  -- 10KB

function M.get_main_output()
  if not build or not build.calcsTab then
    return nil, "build not initialized"
  end
  if build.calcsTab.BuildOutput then
    build.calcsTab:BuildOutput()
  end
  local output = build.calcsTab and build.calcsTab.mainOutput or nil
  if not output then
    return nil, "no output available"
  end
  return output
end

-- PoB colour codes are display-only: "^8" for grey, "^xRRGGBB" for literal.
local function stripColourCodes(text)
  if type(text) ~= 'string' then return text end
  return (text:gsub('%^[xX]%x%x%x%x%x%x', ''):gsub('%^%d', ''))
end

local function leadingNumber(text)
  return tonumber(tostring(stripColourCodes(text)):match('%-?%d+%.?%d*') or '')
end

-- PoB only *applies* a non-damaging ailment to the enemy when the source is
-- guaranteed (a ShockBase/Override/Minimum mod) or when the player has filled
-- in the matching "Effect of X" config. A chance-to-shock skill produces
-- neither, so output.CurrentShock stays 0 and every downstream number silently
-- ignores the ailment. The magnitude the skill would actually inflict is
-- computed in CalcOffence, but only into the CALCS-mode breakdown table, never
-- into output. Read it back out so callers can see both halves.
--
-- breakdown[<Ailment>DPS].rowList is an effect-by-enemy-threshold curve. The
-- one row whose threshold carries a colour-coded tag is the enemy currently
-- configured; the rest are reference points.
local function readAilmentBreakdown(breakdown, ailment)
  local rows = breakdown and breakdown[ailment .. 'DPS'] and breakdown[ailment .. 'DPS'].rowList
  if type(rows) ~= 'table' then return nil, nil end
  local table_, atConfiguredEnemy = {}, nil
  for _, row in ipairs(rows) do
    local threshold = leadingNumber(row.thresh)
    local effect = leadingNumber(row.effect)
    if threshold and effect then
      local isConfiguredEnemy = type(row.thresh) == 'string' and row.thresh:find('%^') ~= nil
      table_[#table_ + 1] = {
        ailmentThreshold = threshold,
        effect = effect,
        note = stripColourCodes(row.effect):match('%((.-)%)'),
        isConfiguredEnemy = isConfiguredEnemy or nil,
      }
      if isConfiguredEnemy then atConfiguredEnemy = effect end
    end
  end
  if #table_ == 0 then return nil, nil end
  return table_, atConfiguredEnemy
end

-- PoB names the enemy-ailment config vars five different ways
-- (conditionShockEffect but conditionEnemyChilledEffect but
-- conditionScorchedEffect...), so guessing them from the ailment name is wrong
-- for most of them. Derive both vars from the option list itself: the effect
-- control is a 'count' gated on the enemy condition it belongs to, and that
-- gate names the ailment.
local ailmentConfigIndex
local function getAilmentConfigIndex()
  if ailmentConfigIndex then return ailmentConfigIndex end
  ailmentConfigIndex = {}
  local ok, varList = pcall(LoadModule, "Modules/ConfigOptions")
  if not ok or type(varList) ~= 'table' then return ailmentConfigIndex end
  for _, varData in ipairs(varList) do
    local gate = varData.var and varData.type == 'count' and varData.ifOption
    local suffix = type(gate) == 'string' and gate:match('^conditionEnemy(%a+)$')
    -- More than one count control hangs off the same gate (ShockStacks shares
    -- conditionEnemyShocked with the effect field), so match the label too.
    local isEffectControl = suffix
      and stripColourCodes(varData.label or ''):match('^Effect of') ~= nil
    if isEffectControl then
      -- "Shocked" -> Shock, "Scorched" -> Scorch, "Brittle" -> Brittle.
      -- Longest match wins so a future ailment cannot shadow a shorter name.
      local best
      for name in pairs((data and data.nonDamagingAilment) or {}) do
        if suffix:sub(1, #name) == name and (not best or #name > #best) then best = name end
      end
      if best then
        ailmentConfigIndex[best] = { effectVar = varData.var, enabledVar = gate }
      end
    end
  end
  return ailmentConfigIndex
end

function M.get_ailments()
  local output, err = M.get_main_output()
  if not output then return nil, err end
  local configInput = build.configTab and build.configTab.input or {}
  local configIndex = getAilmentConfigIndex()
  -- BuildOutput populates two environments; the breakdown only exists in the
  -- CALCS-mode one, and get_main_output hands back the MAIN-mode output.
  local env = build.calcsTab.calcsEnv
  local breakdown = env and env.player and env.player.breakdown or nil

  -- Freeze is the one non-damaging ailment measured in seconds rather than as
  -- an effect magnitude, and CalcPerform's ailment loop skips it for that
  -- reason. It is also the only entry with no default magnitude, so filter on
  -- the data rather than hardcoding a list that would drift.
  local names = {}
  for name, ailment in pairs((data and data.nonDamagingAilment) or {}) do
    if ailment.default ~= nil then names[#names + 1] = name end
  end
  table.sort(names)

  local result = {}
  for _, name in ipairs(names) do
    local chanceOnHit = tonumber(output[name .. 'ChanceOnHit']) or 0
    local chanceOnCrit = tonumber(output[name .. 'ChanceOnCrit']) or 0
    if chanceOnHit > 0 or chanceOnCrit > 0 or (tonumber(output['Current' .. name]) or 0) > 0 then
      local thresholdTable, calculated = readAilmentBreakdown(breakdown, name)
      local applied = tonumber(output['Current' .. name]) or 0
      -- Below the game's minimum the ailment does not land at all, so a small
      -- calculatedEffect must not be read as "a small amount of shock".
      local minimum = data.nonDamagingAilment[name].min
      local config = configIndex[name] or {}
      result[#result + 1] = {
        name = name,
        chanceOnHit = chanceOnHit,
        chanceOnCrit = chanceOnCrit,
        effectMod = tonumber(output[name .. 'EffectMod']),
        duration = tonumber(output[name .. 'Duration']),
        minimumEffect = minimum,
        maximumEffect = tonumber(output['Maximum' .. name]),
        appliedEffect = applied,
        calculatedEffect = calculated,
        -- Scorch, Brittle and Sap have a minimum of 0, so a zero magnitude
        -- would otherwise read as "lands" and raise a warning about nothing.
        landsOnConfiguredEnemy = (calculated ~= nil and calculated > 0
          and calculated >= (minimum or 0)) or nil,
        creditedInCalc = applied > 0,
        effectConfigVar = config.effectVar,
        enabledConfigVar = config.enabledVar,
        enabledOnEnemy = config.enabledVar ~= nil
          and configInput[config.enabledVar] == true or nil,
        thresholdTable = thresholdTable,
      }
    end
  end
  local mainGroup = tonumber(build.mainSocketGroup)
  local calcsGroup = build.calcsTab.input and tonumber(build.calcsTab.input.skill_number)
  local group = mainGroup and build.skillsTab and build.skillsTab.socketGroupList[mainGroup]
  local mainSkill = group and (tonumber(group.mainActiveSkill) or 1)
  local calcsSkill = group and (tonumber(group.mainActiveSkillCalcs) or 1)
  local mainEffect = group and group.displaySkillList and group.displaySkillList[mainSkill] and group.displaySkillList[mainSkill].activeEffect
  local calcsEffect = group and group.displaySkillListCalcs and group.displaySkillListCalcs[calcsSkill] and group.displaySkillListCalcs[calcsSkill].activeEffect
  local sameEffect = mainEffect and calcsEffect and mainEffect.srcInstance and mainEffect.srcInstance == calcsEffect.srcInstance and mainEffect.grantedEffect == calcsEffect.grantedEffect
  return { ailments = result, calculationSelectionMatchesMain = not not (mainGroup ~= nil and calcsGroup ~= nil and mainGroup == calcsGroup and sameEffect) }
end

function M.export_stats(fields)
  local output, err = M.get_main_output()
  if not output then
    return nil, err
  end
  -- Callers that pass no field list get this set, so it has to answer "how is
  -- this build doing" on both axes. Damage was missing entirely, which made
  -- every such caller report a build as if it dealt none.
  local wanted = fields or {
    "TotalDPS", "CombinedDPS", "FullDPS", "AverageDamage", "Speed",
    "CritChance", "CritMultiplier",
    "Life", "EnergyShield", "Armour", "Evasion",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist",
    "BlockChance", "SpellBlockChance",
    "LifeRegen", "Mana", "ManaRegen", "ManaUnreserved",
    "Ward", "DodgeChance", "SpellDodgeChance",
    "TotalEHP", "PhysicalDamageReduction",
    "AttackDodgeChance", "EffectiveMovementSpeedMod",
    "SpellSuppressionChance", "LifeLeechGainRate", "ManaLeechGainRate",
    "EnduranceChargesMax", "FrenzyChargesMax", "PowerChargesMax",
  }
  local result = {}
  for _, k in ipairs(wanted) do
    if type(output[k]) ~= 'nil' then
      result[k] = output[k]
    end
  end
  local minionOutput = output.Minion
  if minionOutput and type(minionOutput) == 'table' then
    local minionWanted = {
      "Life", "EnergyShield", "Armour", "Evasion",
      "TotalDPS", "CombinedDPS", "AverageDamage", "Speed",
      "FireResist", "ColdResist", "LightningResist", "ChaosResist",
      "BlockChance", "PhysicalDamageReduction",
    }
    for _, k in ipairs(minionWanted) do
      if type(minionOutput[k]) ~= 'nil' then
        result["Minion" .. k] = minionOutput[k]
      end
    end
  end
  result._meta = result._meta or {}
  if build and build.targetVersion then
    result._meta.treeVersion = tostring(build.targetVersion)
  end
  if build and build.characterLevel then
    result._meta.level = tonumber(build.characterLevel)
  end
  if build and build.buildName then
    result._meta.buildName = tostring(build.buildName)
  end
  return result
end

function M.get_tree()
  if not build or not build.spec then
    return nil, "build/spec not initialized"
  end
  local spec = build.spec
  local out = {
    treeVersion = spec.treeVersion,
    classId = tonumber(spec.curClassId) or 0,
    ascendClassId = tonumber(spec.curAscendClassId) or 0,
    className = spec.curClass and spec.curClass.name or nil,
    ascendClassName = spec.curAscendClass and spec.curAscendClass.name or nil,
    secondaryAscendClassName = spec.curSecondaryAscendClass and spec.curSecondaryAscendClass.name or nil,
    secondaryAscendClassId = tonumber(spec.curSecondaryAscendClassId or 0) or 0,
    nodes = {},
    masteryEffects = {},
  }
  local ascendancyPointsUsed = 0
  for id, _ in pairs(spec.allocNodes or {}) do
    table.insert(out.nodes, id)
    -- Ascendancy points spent = allocated ascendancy nodes, minus the free
    -- ascendancy-start node every chosen ascendancy grants. TS-side guards
    -- (max-8 cap, unspent-point estimates) treat it exactly this way.
    local node = spec.nodes and spec.nodes[id]
    if node and node.ascendancyName and node.isAscendancyStart ~= true then
      ascendancyPointsUsed = ascendancyPointsUsed + 1
    end
  end
  out.ascendancyPointsUsed = ascendancyPointsUsed
  for mastery, effect in pairs(spec.masterySelections or {}) do
    out.masteryEffects[mastery] = effect
  end
  table.sort(out.nodes)
  return out
end

-- PoB's generated subgraphs retain their owning socket and actual allocations.
-- Read those associations rather than inferring allocation from item text.
function M.get_cluster_jewels()
  if not build or not build.spec or type(build.spec.subGraphs) ~= 'table' then return nil, 'cluster subgraphs unavailable' end
  local spec, jewels, seen = build.spec, setmetatable({}, { __jsontype = 'array' }), {}
  for _, graph in pairs(spec.subGraphs) do
    local parent = graph.parentSocket
    local socketId = parent and tonumber(parent.id)
    local item = socketId and spec:GetSocketedJewel(socketId)
    if not socketId or not item or type(graph.nodes) ~= 'table' then return nil, 'cluster subgraph has no identifiable socket or item' end
    local data = item.jewelData or {}
    local nodes = setmetatable({}, { __jsontype = 'array' })
    for _, node in ipairs(graph.nodes) do
      if node.id and node.type == 'Notable' then
        nodes[#nodes + 1] = { id = node.id, name = node.dn or node.name, allocated = spec.allocNodes[node.id] ~= nil }
      end
    end
    table.sort(nodes, function(a, b) return a.id < b.id end)
    seen[socketId] = true
    jewels[#jewels + 1] = { socketNodeId = socketId, itemId = item.id, name = item.name, baseName = item.baseName,
      raw = item.raw, skill = data.clusterJewelSkill, nodeCount = data.clusterJewelNodeCount, socketAllocated = spec.allocNodes[socketId] ~= nil, graphAvailable = true, notables = nodes }
  end
  -- Include socketed clusters whose socket is not active or whose graph was not
  -- built; missing subgraphs do not imply that there are no notable skills.
  for socketId, itemId in pairs(spec.jewels or {}) do
    local numericId = tonumber(socketId)
    local item = numericId and spec:GetSocketedJewel(numericId)
    if numericId and not seen[numericId] and item and item.clusterJewel then
      local data = item.jewelData or {}
      local knownSocket = spec.nodes and spec.nodes[numericId] ~= nil
      local socketAllocated = nil
      if knownSocket then socketAllocated = spec.allocNodes[numericId] ~= nil end
      jewels[#jewels + 1] = { socketNodeId = numericId, itemId = item.id or itemId, name = item.name, baseName = item.baseName,
        raw = item.raw, skill = data.clusterJewelSkill, nodeCount = data.clusterJewelNodeCount,
        socketAllocated = socketAllocated, graphAvailable = false }
    end
  end
  table.sort(jewels, function(a, b) return a.socketNodeId < b.socketNodeId end)
  return { treeVersion = spec.treeVersion, jewels = jewels }
end

-- params: { classId, ascendClassId, secondaryAscendClassId?, nodes:[int], masteryEffects?:{[id]=effect}, treeVersion? }
function M.set_tree(params)
  if not build or not build.spec then
    return nil, "build/spec not initialized"
  end
  if type(params) ~= 'table' then
    return nil, "invalid params"
  end
  if params.rejectIfOverrides and next(build.spec.hashOverrides or {}) then
    return nil, "tree replacement cannot preserve existing node overrides"
  end
  local classId = tonumber(params.classId or 0) or 0
  local ascendId = tonumber(params.ascendClassId or 0) or 0
  local secondaryId = tonumber(params.secondaryAscendClassId or 0) or 0
  local nodes = {}
  if type(params.nodes) == 'table' then
    for _, v in ipairs(params.nodes) do
      table.insert(nodes, tonumber(v))
    end
  end
  local mastery = params.masteryEffects or {}
  local treeVersion = params.treeVersion
  M.import_from_node_list(build.spec, classId, ascendId, secondaryId, nodes, {}, mastery, treeVersion)
  M.get_main_output()
  return true
end

function M.export_build_xml()
  if not build or not build.SaveDB then
    return nil, 'build not initialized'
  end
  local xml = build:SaveDB('api-export')
  if not xml then return nil, 'failed to compose xml' end
  return xml
end

function M.get_build_notes()
  local edit = build and build.notesTab and build.notesTab.controls and build.notesTab.controls.edit
  if not edit or type(edit.buf) ~= 'string' then return nil, 'PoB notes editor unavailable' end
  return edit.buf
end

function M.set_build_notes(params)
  local edit = build and build.notesTab and build.notesTab.controls and build.notesTab.controls.edit
  if not edit or type(edit.SetText) ~= 'function' then return nil, 'PoB notes editor unavailable' end
  if not params or type(params.notes) ~= 'string' then return nil, 'notes must be a string' end
  edit:SetText(params.notes)
  if edit.buf ~= params.notes then return nil, 'PoB did not apply notes exactly' end
  return true
end

function M.set_level(level)
  if not build or not build.configTab then
    return nil, 'build/config not initialized'
  end
  local lvl = tonumber(level)
  if not lvl or lvl < MIN_PLAYER_LEVEL or lvl > MAX_PLAYER_LEVEL then
    return nil, string.format('invalid level (must be %d-%d)', MIN_PLAYER_LEVEL, MAX_PLAYER_LEVEL)
  end
  build.characterLevel = lvl
  build.characterLevelAutoMode = false
  if build.configTab and build.configTab.BuildModList then
    build.configTab:BuildModList()
  end
  M.get_main_output()
  return true
end

function M.get_build_info()
  if not build then return nil, 'build not initialized' end
  local tree = build.spec and M.get_tree() or nil
  local info = {
    name = build.buildName,
    level = build.characterLevel,
    className = (tree and tree.className) or build.buildClassName or (build.spec and build.spec.curClassName) or nil,
    ascendClassName = (tree and tree.ascendClassName) or build.buildAscendName or (build.spec and build.spec.curAscendClassName) or nil,
    secondaryAscendClassName = tree and tree.secondaryAscendClassName or nil,
    treeVersion = (tree and tree.treeVersion) or build.targetVersion or nil,
  }
  return info
end

-- Reuse PoB's progress estimator after an isolated passive-tree change.
-- The engine does not run the desktop frame loop in stdio mode.
function M.refresh_tree_progress()
  if not build then return nil, 'build not initialized' end
  if not build.characterLevelAutoMode then return true end
  if type(build.EstimatePlayerProgress) ~= 'function' then return nil, 'PoB automatic level estimation unavailable' end
  local ok, err = pcall(function()
    local output, calcErr = M.get_main_output()
    if not output then error(calcErr or 'calculation unavailable') end
    build:EstimatePlayerProgress()
    local updated, updateErr = M.get_main_output()
    if not updated then error(updateErr or 'recalculation unavailable') end
  end)
  if not ok then return nil, 'PoB automatic level estimation failed: ' .. tostring(err) end
  return true
end

function M.update_tree_delta(params)
  if not build or not build.spec then return nil, 'build/spec not initialized' end
  local current, err = M.get_tree()
  if not current then return nil, err end
  local set = {}
  for _, id in ipairs(current.nodes) do set[id] = true end
  if params and type(params.removeNodes) == 'table' then
    for _, id in ipairs(params.removeNodes) do set[tonumber(id)] = nil end
  end
  if params and type(params.addNodes) == 'table' then
    for _, id in ipairs(params.addNodes) do set[tonumber(id)] = true end
  end
  local nodes = {}
  for id,_ in pairs(set) do table.insert(nodes, id) end
  table.sort(nodes)

  local classId = params.classId or current.classId or 0
  local ascendId = params.ascendClassId or current.ascendClassId or 0
  local secId = params.secondaryAscendClassId or current.secondaryAscendClassId or 0
  local tv = params.treeVersion or current.treeVersion
  -- import_from_node_list merges the spec's existing mastery selections
  -- underneath params.masteryEffects itself, so a bare pass-through is enough.
  M.import_from_node_list(build.spec, tonumber(classId) or 0, tonumber(ascendId) or 0, tonumber(secId) or 0, nodes, {}, params and params.masteryEffects, tv)
  M.get_main_output()

  -- Report what PoB actually allocated. Requesting a node is not the same as
  -- getting it: disconnected nodes and effect-less masteries are dropped.
  local after = M.get_tree()
  local allocated = {}
  for _, id in ipairs(after and after.nodes or {}) do allocated[id] = true end
  local dropped = {}
  if params and type(params.addNodes) == 'table' then
    for _, id in ipairs(params.addNodes) do
      local n = tonumber(id)
      if n and not allocated[n] then table.insert(dropped, n) end
    end
  end
  return { tree = after, droppedNodes = dropped }
end


-- PoB's calculation output is a live object graph: actors link back to their
-- parents and to shared ModStores, so it contains reference cycles. Handing it
-- straight to json.encode raises "reference cycle", which is an uncaught error
-- that takes the whole bridge process down. Copy out a JSON-safe projection:
-- scalars only, cycles broken, depth bounded.
local SANITIZE_MAX_DEPTH = 4
local function sanitizeForJson(value, depth, seen)
  local t = type(value)
  if t == 'string' or t == 'boolean' then return value end
  if t == 'number' then
    -- dkjson also refuses NaN and +/-inf.
    if value ~= value or value == math.huge or value == -math.huge then return nil end
    return value
  end
  if t ~= 'table' then return nil end
  if depth >= SANITIZE_MAX_DEPTH then return nil end
  if seen[value] then return nil end
  seen[value] = true
  local out = nil
  for k, v in pairs(value) do
    local kt = type(k)
    if kt == 'string' or kt == 'number' then
      local clean = sanitizeForJson(v, depth + 1, seen)
      if clean ~= nil then
        out = out or {}
        out[k] = clean
      end
    end
  end
  seen[value] = nil
  return out
end

function M.sanitize_for_json(value)
  return sanitizeForJson(value, 0, {})
end

-- A node this build could actually take: on the passive tree proper, or in the
-- build's own ascendancy. Mastery nodes are excluded because allocating one
-- without an effect selection is a no-op (see PassiveSpec:ImportFromNodeList).
function M.is_allocatable(node)
  if type(node) ~= 'table' then return false end
  if node.type == 'Mastery' or node.isMastery then return false end
  if node.type == 'ClassStart' or node.classStartIndex then return false end
  if node.isProxy then return false end
  local asc = node.ascendancyName
  if asc and asc ~= '' then
    local own = build and build.spec and build.spec.curAscendClassName
    if not own or own == '' or asc ~= own then return false end
  end
  return true
end

-- params: { addNodes?: number[], removeNodes?: number[], masteryEffects?: {[nodeId]: effectId}, useFullDPS?: boolean }
function M.calc_with(params)
  if not build or not build.calcsTab then return nil, 'build not initialized' end
  local override = {}
  if params and type(params.addNodes) == 'table' then
    override.addNodes = {}
    for _, id in ipairs(params.addNodes) do
      local n = build.spec and build.spec.nodes and build.spec.nodes[tonumber(id)]
      -- spec.nodes holds every node on the tree, including other classes'
      -- ascendancies. Simulating one of those is not a meaningful "what if"
      -- and can take the calculator down, so only consider allocatable nodes.
      if n and M.is_allocatable(n) then override.addNodes[n] = true end
    end
  end
  if params and type(params.removeNodes) == 'table' then
    override.removeNodes = {}
    for _, id in ipairs(params.removeNodes) do
      local n = build.spec and build.spec.nodes and build.spec.nodes[tonumber(id)]
      if n then override.removeNodes[n] = true end
    end
  end
  -- Temporarily override mastery selections for simulation
  local origMastery = nil
  if params and type(params.masteryEffects) == 'table' then
    for k, v in pairs(params.masteryEffects) do
      local nodeId, effectId = tonumber(k), tonumber(v)
      local node = nodeId and build.spec.nodes[nodeId]
      local valid = false
      if node and node.isMastery and build.spec.allocNodes[nodeId] then
        for _, option in ipairs(node.masteryEffects or {}) do
          if option.effect == effectId then valid = true; break end
        end
      end
      if not valid then return nil, 'invalid or unallocated mastery effect: ' .. tostring(k) .. '=' .. tostring(v) end
    end
    origMastery = {}
    for k, v in pairs(build.spec.masterySelections or {}) do
      origMastery[k] = v
    end
    build.spec.masterySelections = build.spec.masterySelections or {}
    for nodeId, effectId in pairs(params.masteryEffects) do
      build.spec.masterySelections[tonumber(nodeId)] = effectId
    end
  end
  -- pcall returns (ok, result...): the first value is the success flag, not
  -- the stats table. Reading it as the result made every simulation silently
  -- return the caller's CURRENT stats regardless of the override.
  local calcOk, out = pcall(function()
    if origMastery then build.spec:BuildAllDependsAndPaths() end
    local calcFunc = build.calcsTab:GetMiscCalculator()
    return calcFunc(override, params and params.useFullDPS)
  end)
  -- Restore original mastery selections on EVERY path: if calcFunc raised and
  -- we skipped the restore, the next get_tree/save_build would report and
  -- persist masteries the caller never committed.
  if origMastery then
    build.spec.masterySelections = origMastery
    local restoreOk, restoreErr = pcall(function() build.spec:BuildAllDependsAndPaths() end)
    if not restoreOk then return nil, 'failed to restore mastery state: ' .. tostring(restoreErr) end
  end
  if not calcOk then
    return nil, 'calc_with failed: ' .. tostring(out)
  end
  -- The MiscCalculator returns a metatable-backed live object: `pairs()` on it
  -- yields only hand-set keys (nothing), so a direct sanitize would return an
  -- empty object. A table copy strips the metatable so pairs() exposes every
  -- computed stat.
  local function shallowcopy(t)
    local copy = {}
    for k, v in pairs(t) do copy[k] = v end
    return copy
  end
  -- No fallback to baseline stats here: a simulation that produced no stats
  -- table must fail loudly, not pose as the unmodified build.
  if type(out) ~= 'table' then
    return nil, 'calc_with produced no stats table'
  end
  return M.sanitize_for_json(shallowcopy(out))
end


function M.get_config()
  if not build or not build.configTab then return nil, 'build/config not initialized' end
  local input = build.configTab.input
  local cfg = {}
  -- Serialize the full config input table (JSON-encodable values only)
  if type(input) == 'table' then
    for k, v in pairs(input) do
      local vt = type(v)
      if type(k) == 'string' and (vt == 'string' or vt == 'number' or vt == 'boolean') then
        cfg[k] = v
      end
    end
  end
  -- Keep original keys for backward compatibility
  cfg.bandit = (input and input.bandit) or build.bandit
  cfg.pantheonMajorGod = (input and input.pantheonMajorGod) or build.pantheonMajorGod
  cfg.pantheonMinorGod = (input and input.pantheonMinorGod) or build.pantheonMinorGod
  cfg.enemyLevel = build.configTab.enemyLevel
  local set = build.configTab.configSets and build.configTab.configSets[build.configTab.activeConfigSetId]
  for _, block in ipairs(set and set.customModsList or {}) do
    if block.title == 'MCP Custom Mods' then cfg.customMods = block.text end
  end
  return cfg
end

-- Unlike the effective enemyLevel exposed by get_config, this preserves
-- whether the active config set has an explicit override.
function M.get_enemy_level_setting()
  if not build or not build.configTab then return nil, 'build/config not initialized' end
  local tab = build.configTab
  local set = tab.configSets and tab.configSets[tab.activeConfigSetId]
  local input = set and set.input or tab.input
  if type(input) ~= 'table' then return nil, 'active config input unavailable' end
  local value = input.enemyLevel
  if value == nil or value == 0 then return { mode = 'automatic' } end
  if type(value) == 'number' and value == value and value ~= math.huge and value ~= -math.huge and value == math.floor(value) and value > 0 then return { mode = 'explicit', value = value } end
  return nil, 'invalid enemy level input'
end

-- Dropdown options store a val that often differs from what the UI shows: the
-- bandit quest stores "None" but reads "Kill all". Expose the labels so callers
-- can display what PoB displays instead of the raw stored value.
function M.get_config_labels()
  local cfg, err = M.get_config()
  if not cfg then return nil, err end
  local labels = {}
  for k, v in pairs(cfg) do
    local label = M.config_value_label(k, v)
    if label then labels[k] = label end
  end
  return labels
end

function M.set_config(params)
  if not build or not build.configTab then return nil, 'build/config not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local input = build.configTab.input or {}
  build.configTab.input = input
  local index = getConfigVarIndex()
  if not index then return nil, 'could not load PoB config options' end

  local applied, rejected = {}, {}
  local changed = false
  -- PoB's saved-XML import (ConfigTab) maps legacy boss names onto the
  -- current enemyIsBoss list ('Uber Atziri'->'Boss', 'Shaper'/'Sirus' ->
  -- 'Pinnacle'). Doing the same here keeps the tool contract stable for
  -- callers who still speak the old names, instead of failing with
  -- 'not a valid option for this list' while the UI accepts the build file.
  local LEGACY_BOSS_ALIASES = {
    ['shaper'] = 'Pinnacle',
    ['sirus'] = 'Pinnacle',
    ['uber atziri'] = 'Boss',
    ['atziri'] = 'Boss',
  }
  for key, value in pairs(params) do
    if key == 'enemyIsBoss' and type(value) == 'string' then
      local alias = LEGACY_BOSS_ALIASES[value:lower()]
      if alias then value = alias end
    end
    -- enemyLevel is computed from the active config-set input. Writing only
    -- configTab.enemyLevel is overwritten by BuildModList and not serialized.
    if key == 'customMods' and type(value) == 'string' and build.configTab.configSets then
      local set = build.configTab.configSets[build.configTab.activeConfigSetId]
      if not set then
        rejected[key] = 'active config set not found'
      else
        set.customModsList = set.customModsList or {}
        local block
        for _, candidate in ipairs(set.customModsList) do
          if candidate.title == 'MCP Custom Mods' then block = candidate; break end
        end
        if not block then
          block = { title = 'MCP Custom Mods', enabled = true, text = '' }
          table.insert(set.customModsList, block)
        end
        block.text = value
        block.enabled = true
        if build.configTab.UpdateCustomModsControls then build.configTab:UpdateCustomModsControls() end
        build.buildFlag = true
        applied[key] = value
        changed = true
      end
    elseif key == 'enemyLevel' then
      local n = tonumber(value)
      local maximum = data and data.misc and tonumber(data.misc.MaxEnemyLevel)
      if n and n == n and n ~= math.huge and n ~= -math.huge and n == math.floor(n) and n >= 0 and (not maximum or n <= maximum) then
        input.enemyLevel = n
        applied[key] = n
        changed = true
      else
        rejected[key] = 'expected a non-negative integer within PoB enemy level bounds'
      end
    elseif index[key] then
      local coerced, err = coerceConfigValue(index[key], value)
      if err then
        rejected[key] = err
      else
        input[key] = coerced
        applied[key] = coerced
        changed = true
      end
    else
      rejected[key] = 'unknown config option'
    end
  end

  if changed and build.configTab.BuildModList then build.configTab:BuildModList() end
  M.get_main_output()
  return { applied = applied, rejected = rejected }
end


function M.get_skills()
  if not build or not build.skillsTab or not build.calcsTab then return nil, 'skills not initialized' end
  -- Build MAIN output before consulting PoB's selected-skill effect lists.
  local calcOK, output = pcall(M.get_main_output)
  local calcReady = calcOK and output ~= nil
  local groups = {}
  for idx, g in ipairs(build.skillsTab.socketGroupList or {}) do
    local names = {}
    if g.displaySkillList then
      for _, eff in ipairs(g.displaySkillList) do
        if eff and eff.activeEffect and eff.activeEffect.grantedEffect then
          table.insert(names, eff.activeEffect.grantedEffect.name)
        end
      end
    end
    local gems = {}
    if g.gemList then
      for gemIdx, gem in ipairs(g.gemList) do
        local granted = gem.gemData and gem.gemData.grantedEffect or gem.grantedEffect
        local isSupport = granted and granted.support or (gem.skillId and gem.skillId:find('Support') ~= nil) or false
        local gemName = gem.nameSpec or gem.name or ''
        local supportClassificationKnown = type(gemName) == 'string' and gemName:match('%S') ~= nil and (type(granted) == 'table' or (type(gem.skillId) == 'string' and gem.skillId:find('Support') ~= nil))
        local appliedToSelectedSkill = nil
        local selected = g.displaySkillList and g.displaySkillList[tonumber(g.mainActiveSkill) or 1]
        if isSupport and gem.enabled ~= false and g.enabled ~= false and g.slotEnabled ~= false and calcReady
            and selected and type(selected.effectList) == 'table' then
          appliedToSelectedSkill = false
          local function containsGem(effects)
            for _, effect in ipairs(effects or {}) do
              if effect.srcInstance == gem then return true end
            end
            return false
          end
          if containsGem(selected.effectList) then appliedToSelectedSkill = true end
          local minion = selected.minion and selected.minion.mainSkill
          if minion and containsGem(minion.effectList) then appliedToSelectedSkill = true end
        end
        table.insert(gems, {
          index = gemIdx,
          name = gemName,
          level = gem.level or 1,
          quality = gem.quality or 0,
          qualityId = gem.qualityId or 'Default',
          enabled = gem.enabled ~= false,
          isSupport = not not isSupport,
          supportClassificationKnown = not not supportClassificationKnown,
          appliedToSelectedSkill = appliedToSelectedSkill,
          count = tonumber(gem.count) or 1,
          enableGlobal1 = gem.enableGlobal1 ~= false,
          enableGlobal2 = gem.enableGlobal2 == true,
        })
      end
    end
    local slotEnabled = nil
    if calcReady then slotEnabled = g.slotEnabled end
    local selected = g.displaySkillList and g.displaySkillList[tonumber(g.mainActiveSkill) or 1]
    local selectedSource = selected and selected.activeEffect and selected.activeEffect.srcInstance
    table.insert(groups, {
      index = idx,
      label = g.label,
      slot = g.slot,
      enabled = g.enabled,
      slotEnabled = slotEnabled,
      includeInFullDPS = g.includeInFullDPS,
      mainActiveSkill = g.mainActiveSkill,
      selectedSkillPart = selectedSource and selectedSource.skillPart or nil,
      skills = names,
      gems = gems,
    })
  end
  local result = {
    mainSocketGroup = build.mainSocketGroup,
    calcsSkillNumber = build.calcsTab.input and build.calcsTab.input.skill_number or nil,
    groups = groups,
  }
  return result
end


-- Reuse the same compatibility predicate as PoB's GemSelectControl.
-- Compatibility is not a DPS ranking and does not establish availability.
function M.get_compatible_supports(params)
  params = params or {}
  if not build or not build.skillsTab or not build.calcsTab then return nil, 'skills not initialized' end
  local output, err = M.get_main_output()
  if not output then return nil, err or 'calculation unavailable' end
  if not calcLib or type(calcLib.canGrantedEffectSupportActiveSkill) ~= 'function' then return nil, 'PoB support compatibility unavailable' end
  if not build.data or type(build.data.gems) ~= 'table' then return nil, 'PoB gem data unavailable' end
  local index = tonumber(params.groupIndex) or tonumber(build.mainSocketGroup)
  local group = index and build.skillsTab.socketGroupList[index]
  if not group or group.enabled == false or group.slotEnabled == false then return nil, 'selected socket group missing or disabled' end
  local selected = group.displaySkillList and group.displaySkillList[tonumber(group.mainActiveSkill) or 1]
  if not selected or not selected.activeEffect then return nil, 'selected active skill unavailable' end
  local query = tostring(params.query or ''):lower()
  local includeExceptional = params.includeExceptional ~= false
  local limit = math.max(1, math.min(100, tonumber(params.limit) or 25))
  local candidates, seen, failed = {}, {}, 0
  local existing = {}
  for _, gem in ipairs(group.gemList or {}) do
    if gem.nameSpec then existing[tostring(gem.nameSpec):lower()] = true end
  end
  for id, gem in pairs((build.data and build.data.gems) or {}) do
    local effect = gem.grantedEffect
    local exceptional = gem.tagString and gem.tagString:find('Exceptional', 1, true) ~= nil or false
    local name = gem.name or gem.nameSpec
    if effect and effect.support and not effect.hideFromGemList and not effect.legacy and name
        and (includeExceptional or not exceptional) and tostring(name):lower():find(query, 1, true) then
      local ok, compatible = pcall(calcLib.canGrantedEffectSupportActiveSkill, effect, selected)
      if not ok then
        failed = failed + 1
      elseif compatible then
        local key = tostring(id)
        if not seen[key] then
          seen[key] = true
          candidates[#candidates + 1] = { id = key, name = name, exceptional = exceptional, alreadySocketed = not not existing[tostring(name):lower()] }
        end
      end
    end
  end
  table.sort(candidates, function(a, b)
    local an, bn = tostring(a.name):lower(), tostring(b.name):lower()
    if an == bn then return a.id < b.id end
    return an < bn
  end)
  local total = #candidates
  while #candidates > limit do table.remove(candidates) end
  return { groupIndex = index, skillName = selected.activeEffect.grantedEffect and selected.activeEffect.grantedEffect.name,
    candidates = candidates, total = total, failed = failed }
end

local function itemComparisonMetrics(output)
  local values = {}
  for _, key in ipairs({ 'Life', 'EnergyShield', 'TotalEHP', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'TotalDPS', 'CombinedDPS', 'FullDPS' }) do
    local n = output[key]
    if type(n) == 'number' and n == n and n ~= math.huge and n ~= -math.huge then values[key] = n end
  end
  if type(output.Minion) == 'table' then
    for _, key in ipairs({ 'TotalDPS', 'CombinedDPS' }) do
      local n = output.Minion[key]
      if type(n) == 'number' and n == n and n ~= math.huge and n ~= -math.huge then values['Minion' .. key] = n end
    end
  end
  return values
end

-- Capture XML and its item-preview baseline in one bridge request.
local function capture_snapshot(preserve_raw)
  if not build or not build.calcsTab or not build.itemsTab then return nil, 'build not initialized' end
  local ok, result = pcall(function()
    -- ItemsTab:Save normally calls BuildAndParseRaw on every live item, which
    -- mutates their parsed state and raw strings. Save can serialize BuildRaw
    -- and existing modifier ranges without re-parsing the live objects.
    local saved = {}
    if preserve_raw then
      for _, item in pairs(build.itemsTab.items or {}) do
        if type(item.raw) ~= 'string' or item.raw == '' then
          error('cannot capture item without existing raw text')
        end
      end
    end
    for _, item in pairs(build.itemsTab.items or {}) do
      table.insert(saved, { item = item, raw = item.raw, method = rawget(item, 'BuildAndParseRaw') })
      item.BuildAndParseRaw = preserve_raw and function() end or function(self) self.raw = self:BuildRaw() end
    end
    local savedOk, xml, err = pcall(M.export_build_xml)
    for _, entry in ipairs(saved) do
      entry.item.raw = entry.raw
      entry.item.BuildAndParseRaw = entry.method
    end
    if not savedOk then error(xml) end
    if not xml then error(err or 'build export failed') end
    local calc = build.calcsTab:GetMiscCalculator()
    local output = calc({}, true)
    if type(output) ~= 'table' then error('calculator returned no baseline') end
    return { xml = xml, baseline = itemComparisonMetrics(output) }
  end)
  if not ok then return nil, 'item comparison snapshot failed: ' .. tostring(result) end
  return result
end

function M.item_comparison_snapshot()
  return capture_snapshot(false)
end

-- Only suitable for operations that have not modified item objects.
function M.unchanged_items_snapshot()
  return capture_snapshot(true)
end

-- Delegate base/influence tag weighting to PoB; crafting mechanics are separate.
function M.get_item_affix_weight(params)
  if not build or not build.data or not build.data.itemMods then return nil, 'build data not initialized' end
  if type(params) ~= 'table' or type(params.modId) ~= 'string' or #params.modId == 0 or #params.modId > 200 or
     type(params.itemText) ~= 'string' or #params.itemText == 0 or #params.itemText > MAX_ITEM_TEXT_LENGTH then return nil, 'invalid mod ID or item text' end
  local ok, result = pcall(function()
    local mods = build.data.itemMods.Explicit or build.data.itemMods.Item
    local mod = mods and mods[params.modId]
    if not mod then error('modifier ID not found in PoB item data') end
    local item = new('Item'):Item(params.itemText)
    if not item or not item.base or not item.baseName then error('item could not be parsed') end
    local weight = item:GetModSpawnWeight(mod)
    if type(weight) ~= 'number' or weight ~= weight or weight == math.huge or weight == -math.huge then error('invalid spawn weight') end
    return { modId = params.modId, base = item.baseName, weight = weight, itemLevel = item.itemLevel,
      requiredItemLevel = mod.level, affixType = mod.type, affixGroup = mod.group }
  end)
  if not ok then return nil, 'PoB item affix weight failed: ' .. tostring(result) end
  return result
end

-- Item:BuildModList skips active lines with extra unparsed text.
local function itemParseDiagnostics(target)
  local unparsed = setmetatable({}, { __jsontype = 'array' })
  if not target then return { available = false, unparsed = unparsed } end
  for _, group in ipairs({ 'enchant', 'scourge', 'implicit', 'explicit', 'crucible', 'buff' }) do
    for _, line in ipairs(target[group .. 'ModLines'] or {}) do
      if line.extra and not line.disabled then
        local okVariant, active
        if group == 'buff' then okVariant, active = pcall(function() return target:CheckModLineVariant(line) end)
        else okVariant, active = pcall(function() return target:GetModLineVariantCount(line) > 0 end) end
        if not okVariant or active then
          table.insert(unparsed, { group = group, line = line.line, extra = tostring(line.extra), active = okVariant and true or nil })
        end
      end
    end
  end
  return { available = true, unparsed = unparsed }
end

function M.inspect_item_parse(params)
  if type(params) ~= 'table' or type(params.itemText) ~= 'string' or #params.itemText == 0 or #params.itemText > MAX_ITEM_TEXT_LENGTH then return nil, 'invalid item text' end
  local ok, item = pcall(function() return new('Item'):Item(params.itemText) end)
  if not ok or not item or not item.base or not item.baseName then return nil, 'item could not be parsed' end
  return { base = item.baseName, diagnostics = itemParseDiagnostics(item) }
end

-- Non-destructive item comparison using PoB's own item tooltip calculator.
function M.compare_item(params)
  if not build or not build.itemsTab or not build.calcsTab then return nil, 'build not initialized' end
  if type(params) ~= 'table' or type(params.slot) ~= 'string' or type(params.itemText) ~= 'string' or #params.itemText == 0 or #params.itemText > MAX_ITEM_TEXT_LENGTH then return nil, 'invalid slot or item text' end
  local tab, slotName = build.itemsTab, params.slot
  local slot = tab.slots and tab.slots[slotName]
  if not slot or slot.nodeId or slotName:find('Flask') or slotName:find('Swap') or slotName:find('Socket') then return nil, 'slot is not a supported equipment slot' end
  local ok, result = pcall(function()
    if slot.inactive or (slot.weaponSet and slot.weaponSet ~= (tab.activeItemSet.useSecondWeaponSet and 2 or 1)) or (type(slot.IsShown) == 'function' and not slot:IsShown()) then error('slot is inactive or hidden') end
    local item = new('Item'):Item(params.itemText)
    if not item or not item.base or not item.baseName then error('item could not be parsed') end
    -- PoB's NormaliseQuality upgrades some trade-imported items to 20% when
    -- they lack a Unique ID. A listing preview must preserve the given item.
    if item.quality == nil and (item.base.armour or item.base.weapon) then item.quality = 0 end
    if not tab:IsItemValidForSlot(item, slotName) then error('item is incompatible with slot') end
    local calc = build.calcsTab:GetMiscCalculator()
    local before = calc({}, true)
    local after = calc({ repSlotName = slotName, repItem = item }, true)
    if type(before) ~= 'table' or type(after) ~= 'table' then error('calculator returned no stats') end
    local current = slot.selItemId and tab.items[slot.selItemId] or nil
    return { slot = slotName, candidate = { name = item.name, base = item.baseName, quality = item.quality },
      baseline = itemComparisonMetrics(before), candidateStats = itemComparisonMetrics(after),
      parseDiagnostics = { current = itemParseDiagnostics(current), candidate = itemParseDiagnostics(item) } }
  end)
  if not ok then return nil, 'item comparison failed: ' .. tostring(result) end
  return result
end

function M.set_main_selection(params)
  if not build or not build.skillsTab or not build.calcsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local function validIndex(value)
    return type(value) == 'number' and value >= 1 and value < math.huge and value == math.floor(value)
  end
  if params.mainSocketGroup ~= nil and not validIndex(params.mainSocketGroup) then return nil, 'invalid mainSocketGroup' end
  if params.mainActiveSkill ~= nil and not validIndex(params.mainActiveSkill) then return nil, 'invalid mainActiveSkill' end
  if params.skillPart ~= nil and not validIndex(params.skillPart) then return nil, 'invalid skillPart' end
  local index = params.mainSocketGroup or build.mainSocketGroup
  local g = build.skillsTab.socketGroupList[index]
  if not g then return nil, 'invalid mainSocketGroup' end
  local skillIndex = params.mainActiveSkill or g.mainActiveSkill or 1
  local selected = g.displaySkillList and g.displaySkillList[skillIndex]
  if params.mainActiveSkill ~= nil and not selected then return nil, 'invalid mainActiveSkill' end
  local src
  if params.skillPart ~= nil then
    local effect = selected and selected.activeEffect
    src = effect and effect.srcInstance
    local parts = effect and effect.grantedEffect and effect.grantedEffect.parts
    local partCount = type(parts) == 'table' and math.max(1, #parts) or 1
    if not src or params.skillPart > partCount then return nil, 'invalid skillPart' end
  end
  local oldGroup, oldSkill, oldCalcs, oldPart = build.mainSocketGroup, g.mainActiveSkill, build.calcsTab.input.skill_number, src and src.skillPart
  build.mainSocketGroup = index
  if params.mainActiveSkill ~= nil then g.mainActiveSkill = params.mainActiveSkill end
  if src then src.skillPart = params.skillPart end
  build.calcsTab.input.skill_number = index
  local ok, output = pcall(M.get_main_output)
  if not ok or not output then
    build.mainSocketGroup, g.mainActiveSkill, build.calcsTab.input.skill_number = oldGroup, oldSkill, oldCalcs
    if src then src.skillPart = oldPart end
    local restored, restoredOutput = pcall(M.get_main_output)
    if not restored or not restoredOutput then return nil, 'main skill recalculation failed and rollback could not be verified' end
    return nil, 'main skill recalculation failed; selection restored'
  end
  return true
end

function M.set_calcs_selection(params)
  if not build or not build.skillsTab or not build.calcsTab or not build.calcsTab.input then return nil, 'skills not initialized' end
  local index = params and params.groupIndex
  if type(index) ~= 'number' or index < 1 or index >= math.huge or index ~= math.floor(index) or not build.skillsTab.socketGroupList[index] then return nil, 'invalid calculation skill group' end
  local previous = build.calcsTab.input.skill_number
  build.calcsTab.input.skill_number = index
  local ok, output = pcall(M.get_main_output)
  if not ok or not output then
    build.calcsTab.input.skill_number = previous
    local restored, restoredOutput = pcall(M.get_main_output)
    if not restored or not restoredOutput then return nil, 'calculation selection failed and rollback could not be verified' end
    return nil, 'calculation selection failed; selection restored'
  end
  return true
end

function M.add_item_text(params)
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  if type(params) ~= 'table' or type(params.text) ~= 'string' then return nil, 'missing text' end

  if #params.text == 0 then return nil, 'item text cannot be empty' end
  if #params.text > MAX_ITEM_TEXT_LENGTH then
    return nil, string.format('item text too long (max %d bytes)', MAX_ITEM_TEXT_LENGTH)
  end

  local ok, item = pcall(function() return new('Item'):Item(params.text) end)
  if not ok then return nil, 'invalid item text: ' .. tostring(item) end
  if not item or not item.baseName or not item.base then return nil, 'failed to parse item base' end

  local tab, selectedSlot = build.itemsTab, nil
  if params.slotName ~= nil then
    if type(params.slotName) ~= 'string' or params.slotName == '' then return nil, 'invalid slot name' end
    selectedSlot = tab.slots[params.slotName]
    if not selectedSlot then return nil, string.format('unknown slot "%s"; item was not added', params.slotName) end
    local valid, compatible = pcall(function() return tab:IsItemValidForSlot(item, params.slotName) end)
    if not valid or not compatible then return nil, 'item is incompatible with the requested slot; item was not added' end
  end

  -- Preserve clipboard quality; PoB's UI-oriented normalizer can silently
  -- raise an uncorrupted item without a Unique ID to 20%.
  if item.quality == nil and item.base and (item.base.armour or item.base.weapon) then item.quality = 0 end
  -- Explicit destination must not also auto-equip into a different empty slot.
  tab:AddItem(item, selectedSlot ~= nil or params.noAutoEquip == true)
  if selectedSlot then
    selectedSlot:SetSelItemId(item.id)
    tab:PopulateSlots()
  end
  local equippedSlot
  for slotName, slot in pairs(tab.slots) do
    if slot.selItemId == item.id then equippedSlot = slotName; break end
  end
  tab:AddUndoState()
  build.buildFlag = true
  M.get_main_output()
  return { id = item.id, name = item.name, slot = equippedSlot }
end

function M.set_flask_active(params)
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if type(params.active) ~= 'boolean' then return nil, 'active must be a boolean' end
  local idx = tonumber(params.index)
  local active = params.active == true
  if not idx or idx < 1 or idx > NUM_FLASK_SLOTS or idx ~= math.floor(idx) then
    return nil, string.format('invalid flask index (must be 1-%d)', NUM_FLASK_SLOTS)
  end
  local slotName = 'Flask ' .. tostring(idx)
  if not build.itemsTab.activeItemSet or not build.itemsTab.activeItemSet[slotName] or not build.itemsTab.slots or not build.itemsTab.slots[slotName] then return nil, 'slot not found' end
  -- ItemSlotControl updates both: calculations read the live slot, while
  -- serialization reads the active item set. Keeping only one is stale.
  build.itemsTab.slots[slotName].active = active
  build.itemsTab.activeItemSet[slotName].active = active
  -- Re-populate slots so flask effects are applied before recalculating
  if build.itemsTab.PopulateSlots then
    build.itemsTab:PopulateSlots()
  end
  if build.configTab and build.configTab.BuildModList then
    build.configTab:BuildModList()
  end
  build.itemsTab:AddUndoState()
  build.buildFlag = true
  M.get_main_output()
  return true
end


function M.get_items()
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  local itemsTab = build.itemsTab
  local result = { }
  -- Prefer orderedSlots for deterministic order
  local ordered = itemsTab.orderedSlots or {}
  local seen = {}
  local function add_slot(slotName)
    if seen[slotName] then return end
    seen[slotName] = true
    local slotCtrl = itemsTab.slots[slotName]
    if not slotCtrl then return end
    local selId = slotCtrl.selItemId or 0
    local entry = { slot = slotName, id = selId }
    -- PoB's own slot visibility gate (Control:IsShown evaluates .shown, a
    -- boolean or function): ItemsTab hides Ring 3 (AdditionalRingSlot flag),
    -- Graft 1/2 (pre-3_27 trees) and the inactive weapon-set variants.
    -- Consumers need shown=false to tell "empty" from "does not apply to
    -- this build". A gate that errors stays shown: analysis must not
    -- silently lose data.
    local gate = slotCtrl.shown
    local vis = true
    if type(gate) == 'function' then
      local okGate, v = pcall(gate)
      if okGate then
        vis = v ~= false and v ~= nil
      else
        -- A failing gate stays shown so analysis never loses data silently,
        -- EXCEPT the version-flagged slots: their gates dereference calcs
        -- state (Ring 3 reads mainEnv.modDB) that may not exist yet, and a
        -- wrongly-shown Ring 3 is the exact false 'slot is empty' this
        -- gate exists to prevent. For those three, unknown means hidden.
        vis = not (slotName == 'Ring 3' or slotName == 'Graft 1' or slotName == 'Graft 2')
      end
    elseif gate ~= nil then
      vis = gate ~= false
    end
    entry.shown = vis
    if selId > 0 then
      local it = itemsTab.items[selId]
      if it then
        entry.name = it.name
        entry.baseName = it.baseName
        entry.type = it.type
        entry.rarity = it.rarity
        entry.raw = it.raw
      end
    end
    -- Flask/Tincture activation flag stored in activeItemSet
    local set = itemsTab.activeItemSet
    if set and set[slotName] and set[slotName].active ~= nil then
      entry.active = set[slotName].active and true or false
    end
    table.insert(result, entry)
  end
  for _, slot in ipairs(ordered) do
    if slot and slot.slotName then add_slot(slot.slotName) end
  end
  -- Add any remaining slots not in ordered list
  for slotName, _ in pairs(itemsTab.slots or {}) do add_slot(slotName) end
  return result
end


-- params: { label?: string, slot?: string, enabled?: boolean, includeInFullDPS?: boolean }
function M.create_socket_group(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then params = {} end

  if params.label ~= nil and type(params.label) ~= 'string' then return nil, 'invalid group label' end
  if params.enabled ~= nil and type(params.enabled) ~= 'boolean' then return nil, 'invalid enabled flag' end
  if params.includeInFullDPS ~= nil and type(params.includeInFullDPS) ~= 'boolean' then return nil, 'invalid Full DPS flag' end
  if params.slot ~= nil then
    if type(params.slot) ~= 'string' or params.slot == '' then return nil, 'invalid skill group slot' end
    local control = build.skillsTab.controls and build.skillsTab.controls.groupSlot
    if not control or type(control.list) ~= 'table' then return nil, 'PoB skill group slot list is unavailable' end
    local supported = false
    for _, option in ipairs(control.list) do
      if option.slotName == params.slot then supported = true; break end
    end
    if not supported or not build.itemsTab or not build.itemsTab.slots[params.slot] then
      return nil, 'skill group slot is not supported by this PoB build'
    end
  end

  local socketGroup = {
    label = params.label or '',
    slot = params.slot,
    enabled = params.enabled ~= false,
    includeInFullDPS = params.includeInFullDPS == true,
    gemList = {},
    mainActiveSkill = 1,
    mainActiveSkillCalcs = 1,
  }

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  table.insert(skillSet.socketGroupList, socketGroup)
  local index = #skillSet.socketGroupList

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return { index = index, label = socketGroup.label }
end

-- params: { groupIndex: number, gemName: string, level?: number, quality?: number, qualityId?: string, enabled?: boolean }
function M.add_gem(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemName then return nil, 'missing groupIndex or gemName' end
  local function validInteger(value, min, max)
    return type(value) == 'number' and value >= min and value <= max and value == math.floor(value)
  end
  if params.level ~= nil and not validInteger(params.level, 1, 40) then return nil, 'invalid level (must be an integer from 1 to 40)' end
  if params.quality ~= nil and not validInteger(params.quality, 0, 99) then return nil, 'invalid quality (must be an integer from 0 to 99)' end
  if params.count ~= nil and not validInteger(params.count, 1, 10000) then return nil, 'invalid count (must be a positive integer up to 10000)' end
  if params.qualityId ~= nil and params.qualityId ~= 'Default' then return nil, 'unsupported quality type; only Default is verified for this PoB adapter' end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found at index ' .. tostring(groupIndex) end

  if not build.data or type(build.data.gems) ~= 'table' then return nil, 'PoB gem data unavailable' end
  local requested = tostring(params.gemName):match('^%s*(.-)%s*$')
  if requested == '' then return nil, 'unrecognized gem: empty name' end
  local folded = requested:lower()
  local matches = {}
  for id, gemData in pairs(build.data.gems) do
    local name = gemData.name and tostring(gemData.name):lower()
    local spec = gemData.nameSpec and tostring(gemData.nameSpec):lower()
    if name == folded or spec == folded then matches[tostring(id)] = gemData end
  end
  -- PoB's base-name index handles the conventional "Support" suffix.
  if not next(matches) and build.data.gemForBaseName then
    local id = build.data.gemForBaseName[folded]
    if id and build.data.gems[id] then matches[tostring(id)] = build.data.gems[id] end
  end
  local matchId, match, count = nil, nil, 0
  for id, gemData in pairs(matches) do matchId, match, count = id, gemData, count + 1 end
  if count == 0 then return nil, 'unrecognized gem: ' .. requested end
  if count > 1 then return nil, 'ambiguous gem name: ' .. requested end
  if not match.grantedEffect then return nil, 'unrecognized gem effect: ' .. requested end
  local gemInstance = {
    nameSpec = match.name or requested,
    gemId = match.id or matchId,
    skillId = match.grantedEffect.id or match.grantedEffectId,
    gemData = match,
    level = tonumber(params.level) or 20,
    quality = tonumber(params.quality) or 0,
    qualityId = params.qualityId or 'Default',
    enabled = params.enabled ~= false,
    enableGlobal1 = params.enableGlobal1 ~= false,
    enableGlobal2 = params.enableGlobal2 == true,
    count = tonumber(params.count) or 1,
  }

  local gemIndex = #socketGroup.gemList + 1
  if params.insertIndex ~= nil then
    local requestedIndex = tonumber(params.insertIndex)
    if not requestedIndex or requestedIndex % 1 ~= 0 or requestedIndex < 1 or requestedIndex > gemIndex then
      return nil, 'insertIndex must be a valid 1-based position in the socket group'
    end
    gemIndex = requestedIndex
  end
  table.insert(socketGroup.gemList, gemIndex, gemInstance)

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return { gemIndex = gemIndex, name = gemInstance.nameSpec }
end

-- params: { groupIndex: number, gemIndex: number, level: number }
function M.set_gem_level(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex or not params.level then
    return nil, 'missing groupIndex, gemIndex, or level'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local gemIndex = tonumber(params.gemIndex)
  local level = tonumber(params.level)

  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end

  if not level or level < 1 or level > 40 or level ~= math.floor(level) then return nil, 'invalid level (must be an integer from 1 to 40)' end

  gemInstance.level = level

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end

-- params: { groupIndex: number, gemIndex: number, quality: number, qualityId?: string }
function M.set_gem_quality(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex or not params.quality then
    return nil, 'missing groupIndex, gemIndex, or quality'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local gemIndex = tonumber(params.gemIndex)
  local quality = tonumber(params.quality)

  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end

  if not quality or quality < 0 or quality > 99 or quality ~= math.floor(quality) then return nil, 'invalid quality (must be an integer from 0 to 99)' end
  if params.qualityId ~= nil and params.qualityId ~= 'Default' then return nil, 'unsupported quality type; only Default is verified for this PoB adapter' end

  gemInstance.quality = quality
  if params.qualityId then
    gemInstance.qualityId = tostring(params.qualityId)
  end

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end

-- params: { groupIndex: number }
function M.remove_skill(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex then return nil, 'missing groupIndex' end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  -- Don't allow removing special groups with sources
  if socketGroup.source then
    return nil, 'cannot remove special socket groups (item/node granted skills)'
  end

  table.remove(skillSet.socketGroupList, groupIndex)

  build.buildFlag = true
  M.get_main_output()

  return true
end

-- params: { groupIndex: number, gemIndex: number }
function M.remove_gem(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex then
    return nil, 'missing groupIndex or gemIndex'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local gemIndex = tonumber(params.gemIndex)

  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end

  table.remove(socketGroup.gemList, gemIndex)

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end


-- params: { path: string }
function M.save_build(params)
  if not build or not build.SaveDB then
    return nil, 'build not initialized'
  end
  if type(params) ~= 'table' or type(params.path) ~= 'string' or params.path == '' then
    return nil, 'missing or invalid path'
  end

  -- Sync curAscendClassName from the current ascendClassId so the Build XML
  -- element always reflects the live state (guards against stale names after
  -- set_tree or new_build with a different ascendancy).
  if build.spec and build.spec.curClass and build.spec.curClass.classes then
    local ascendId = build.spec.curAscendClassId or 0
    local ascendClass = build.spec.curClass.classes[ascendId] or build.spec.curClass.classes[0]
    if ascendClass and ascendClass.name then
      build.spec.curAscendClassName = ascendClass.name
    end
  end

  -- Re-process all socket groups so that gem modifications made via add_gem /
  -- set_gem_level / set_gem_quality are fully resolved before SaveDB serialises
  -- the skillsTab.  ProcessSocketGroup populates gemData / grantedEffect from
  -- the current gemId/nameSpec, ensuring accurate gemId and nameSpec values in
  -- the output XML.
  if build.skillsTab and build.skillsTab.socketGroupList then
    for _, socketGroup in ipairs(build.skillsTab.socketGroupList) do
      if build.skillsTab.ProcessSocketGroup then
        build.skillsTab:ProcessSocketGroup(socketGroup)
      end
    end
  end

  local xml = build:SaveDB('api-export')
  if not xml then return nil, 'failed to compose xml' end
  local f, ferr = io.open(params.path, 'w')
  if not f then return nil, 'failed to open file: ' .. tostring(ferr) end
  local ok, werr = f:write(xml)
  f:close()
  if not ok then return nil, 'failed to write file: ' .. tostring(werr) end
  return { path = params.path, size = #xml }
end

function M.list_specs()
  if not build or not build.treeTab then return nil, 'build/treeTab not initialized' end
  local specs = {}
  for i, spec in ipairs(build.treeTab.specList or {}) do
    local nodeCount = 0
    for _ in pairs(spec.allocNodes or {}) do nodeCount = nodeCount + 1 end
    table.insert(specs, {
      index = i,
      title = spec.title or ('Spec ' .. i),
      active = (i == build.treeTab.activeSpec),
      className = spec.curClassName,
      ascendClassName = spec.curAscendClassName,
      treeVersion = spec.treeVersion,
      nodeCount = nodeCount,
    })
  end
  return { specs = specs, activeSpec = build.treeTab.activeSpec }
end

function M.select_spec(params)
  if not build or not build.treeTab then return nil, 'build/treeTab not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local index = tonumber(params.index)
  local specCount = #(build.treeTab.specList or {})
  if not index or not build.treeTab.specList[index] then
    return nil, string.format('spec index %s not found (valid range: 1-%d)', tostring(params.index), specCount)
  end
  build.treeTab:SetActiveSpec(index)
  M.get_main_output()
  return M.list_specs()
end

function M.list_item_sets()
  if not build or not build.itemsTab then return nil, 'build/itemsTab not initialized' end
  local sets = {}
  for _, id in ipairs(build.itemsTab.itemSetOrderList or {}) do
    local itemSet = build.itemsTab.itemSets[id]
    if itemSet then
      table.insert(sets, {
        id = id,
        title = itemSet.title or ('Item Set ' .. id),
        active = (id == build.itemsTab.activeItemSetId),
        useSecondWeaponSet = itemSet.useSecondWeaponSet == true,
      })
    end
  end
  return { itemSets = sets, activeItemSetId = build.itemsTab.activeItemSetId }
end

function M.select_item_set(params)
  if not build or not build.itemsTab then return nil, 'build/itemsTab not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local id = tonumber(params.id)
  if not id or not build.itemsTab.itemSets[id] then
    return nil, string.format('item set id %s not found', tostring(params.id))
  end
  build.itemsTab:SetActiveItemSet(id)
  if build.itemsTab.PopulateSlots then
    build.itemsTab:PopulateSlots()
  end
  if build.configTab and build.configTab.BuildModList then
    build.configTab:BuildModList()
  end
  M.get_main_output()
  return M.list_item_sets()
end


-- params: { title?: string, copyFrom?: number (spec index), activate?: boolean }
function M.create_spec(params)
  if not build or not build.treeTab then return nil, 'build/treeTab not initialized' end
  params = type(params) == 'table' and params or {}
  local specList = build.treeTab.specList
  if not specList then return nil, 'spec list not available' end
  local source = nil
  if params.copyFrom ~= nil then
    source = specList[tonumber(params.copyFrom)]
    if not source then
      return nil, string.format('copyFrom spec index %s not found (valid range: 1-%d)', tostring(params.copyFrom), #specList)
    end
  end
  local version = (source and source.treeVersion) or (build.spec and build.spec.treeVersion) or latestTreeVersion
  local newSpec = new('PassiveSpec'):PassiveSpec(build, version)
  if source then
    -- Same copy mechanism TreeTab uses for its spec management popup
    newSpec.jewels = copyTable(source.jewels)
    newSpec:RestoreUndoState(source:CreateUndoState(), version)
    if newSpec.BuildClusterJewelGraphs then newSpec:BuildClusterJewelGraphs() end
  end
  newSpec.title = params.title and tostring(params.title)
    or (source and source.title and (tostring(source.title) .. ' (copy)'))
    or ('Spec ' .. (#specList + 1))
  table.insert(specList, newSpec)
  build.modFlag = true
  if params.activate ~= false then
    build.treeTab:SetActiveSpec(#specList)
    M.get_main_output()
  end
  return M.list_specs()
end

-- params: { index: number }
function M.delete_spec(params)
  if not build or not build.treeTab then return nil, 'build/treeTab not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local specList = build.treeTab.specList or {}
  local index = tonumber(params.index)
  if not index or not specList[index] then
    return nil, string.format('spec index %s not found (valid range: 1-%d)', tostring(params.index), #specList)
  end
  if #specList <= 1 then return nil, 'cannot delete the only remaining spec' end
  table.remove(specList, index)
  local active = build.treeTab.activeSpec or 1
  if active > index then
    build.treeTab:SetActiveSpec(active - 1)
  elseif active == index then
    build.treeTab:SetActiveSpec(math.min(index, #specList))
  end
  build.modFlag = true
  M.get_main_output()
  return M.list_specs()
end

-- params: { index: number, title: string }
function M.rename_spec(params)
  if not build or not build.treeTab then return nil, 'build/treeTab not initialized' end
  if type(params) ~= 'table' or params.title == nil then return nil, 'missing index or title' end
  local specList = build.treeTab.specList or {}
  local index = tonumber(params.index)
  local spec = index and specList[index]
  if not spec then
    return nil, string.format('spec index %s not found (valid range: 1-%d)', tostring(params.index), #specList)
  end
  spec.title = tostring(params.title)
  build.modFlag = true
  return M.list_specs()
end

-- params: { groupIndex: number, enabled: boolean }
function M.set_socket_group_enabled(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' or params.groupIndex == nil or params.enabled == nil then
    return nil, 'missing groupIndex or enabled'
  end
  if type(params.enabled) ~= 'boolean' then return nil, 'enabled must be a boolean' end
  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end
  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = groupIndex and skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end
  socketGroup.enabled = params.enabled == true
  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end
  build.buildFlag = true
  M.get_main_output()
  return {
    groupIndex = groupIndex,
    label = socketGroup.displayLabel or socketGroup.label or ('Group ' .. groupIndex),
    enabled = socketGroup.enabled == true,
  }
end

-- params: { groupIndex: number, gemIndex: number, enabled: boolean }
function M.set_gem_enabled(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' or params.groupIndex == nil or params.gemIndex == nil or params.enabled == nil then
    return nil, 'missing groupIndex, gemIndex or enabled'
  end
  if type(params.enabled) ~= 'boolean' then return nil, 'enabled must be a boolean' end
  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end
  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = groupIndex and skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end
  local gemIndex = tonumber(params.gemIndex)
  local gemInstance = gemIndex and socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end
  gemInstance.enabled = params.enabled == true
  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end
  build.buildFlag = true
  M.get_main_output()
  return true
end

-- params: { keyword: string, nodeType?: string ('normal'|'notable'|'keystone'), maxResults?: number, includeAllocated?: boolean }
function M.search_nodes(params)
  if not build or not build.spec then return nil, 'build/spec not initialized' end
  if type(params) ~= 'table' or type(params.keyword) ~= 'string' then
    return nil, 'missing or invalid keyword'
  end

  local keyword = params.keyword:lower()
  local nodeType = params.nodeType and params.nodeType:lower() or nil
  local maxResults = tonumber(params.maxResults) or 50
  local includeAllocated = params.includeAllocated ~= false

  local results = {}
  local count = 0

  local allocatedSet = {}
  if build.spec.allocNodes then
    for id, _ in pairs(build.spec.allocNodes) do
      allocatedSet[id] = true
    end
  end

  for id, node in pairs(build.spec.nodes) do
    if count >= maxResults then break end

    if not includeAllocated and allocatedSet[id] then
      goto continue
    end

    if nodeType then
      local nType = 'normal'
      if node.isKeystone then nType = 'keystone'
      elseif node.isNotable then nType = 'notable'
      elseif node.isJewelSocket then nType = 'jewel'
      elseif node.isMastery or node.type == 'Mastery' then nType = 'mastery'
      elseif node.ascendancyName then nType = 'ascendancy'
      end
      if nType ~= nodeType then goto continue end
    end

    local matches = false
    if node.name and node.name:lower():find(keyword, 1, true) then
      matches = true
    end

    if not matches and node.sd then
      for _, stat in ipairs(node.sd) do
        if type(stat) == 'string' and stat:lower():find(keyword, 1, true) then
          matches = true
          break
        end
      end
    end

    if not matches and node.modList then
      for _, mod in ipairs(node.modList) do
        local modStr = tostring(mod)
        if modStr:lower():find(keyword, 1, true) then
          matches = true
          break
        end
      end
    end

    if matches then
      local pathNodes = nil
      if not allocatedSet[id] and type(node.path) == 'table' and node.pathDist and node.pathDist < 1000 then
        pathNodes = {}
        for index = #node.path, 1, -1 do
          local pathNode = node.path[index]
          if pathNode and not pathNode.alloc and pathNode.id then
            table.insert(pathNodes, pathNode.id)
          end
        end
      end
      local nodeType = 'normal'
      if node.isKeystone then nodeType = 'keystone'
      elseif node.isNotable then nodeType = 'notable'
      elseif node.isJewelSocket then nodeType = 'jewel'
      elseif node.isMastery or node.type == 'Mastery' then nodeType = 'mastery'
      elseif node.ascendancyName then nodeType = 'ascendancy'
      end

      local stats = {}
      if node.sd then
        for _, stat in ipairs(node.sd) do
          if type(stat) == 'string' then
            table.insert(stats, stat)
          end
        end
      end

      table.insert(results, {
        id = id,
        name = node.name or 'Unnamed',
        type = nodeType,
        stats = stats,
        allocated = allocatedSet[id] == true,
        x = node.x,
        y = node.y,
        orbit = node.orbit,
        orbitIndex = node.orbitIndex,
        ascendancyName = node.ascendancyName,
        isMastery = node.isMastery == true or node.type == 'Mastery',
        pathNodes = pathNodes,
        -- Blight notables sit off the tree and are reached by anointing, not by
        -- spending a point; callers need to tell them apart from real nodes.
        isBlighted = node.isBlighted == true,
      })
      count = count + 1
    end

    ::continue::
  end

  -- Sort results: keystones first, then notables, then normal
  table.sort(results, function(a, b)
    local typeOrder = { keystone = 1, notable = 2, jewel = 3, mastery = 4, ascendancy = 5, normal = 6 }
    local aOrder = typeOrder[a.type] or 99
    local bOrder = typeOrder[b.type] or 99
    if aOrder ~= bOrder then
      return aOrder < bOrder
    end
    return (a.name or '') < (b.name or '')
  end)

  return { nodes = results, count = #results }
end

-- Returns all allocated mastery nodes and the available effect options for each.
-- Output: { masteries: [ { nodeId, nodeName, allocatedEffect, availableEffects: [{effectId, stat}] } ] }
function M.get_mastery_options()
  if not build or not build.spec then
    return nil, 'build/spec not initialized'
  end
  local spec = build.spec
  local result = setmetatable({}, { __jsontype = 'array' })
  for nodeId, _ in pairs(spec.allocNodes or {}) do
    local node = spec.nodes[nodeId]
    if node and node.isMastery and node.masteryEffects then
      local allocated = spec.masterySelections and spec.masterySelections[nodeId]
      local available = setmetatable({}, { __jsontype = 'array' })
      -- node.masteryEffects is an array of { effect = <id>, stats = {...} }.
      for _, effectData in ipairs(node.masteryEffects) do
        local stat = effectData.stats and table.concat(effectData.stats, ', ') or tostring(effectData.effect)
        table.insert(available, { effectId = effectData.effect, stat = stat })
      end
      table.insert(result, {
        nodeId = nodeId,
        nodeName = node.name or 'Mastery',
        allocatedEffect = allocated,
        availableEffects = available,
      })
    end
  end
  return { masteries = result }
end


-- Exposes data only. An option existing does not prove the node is allocatable.
function M.get_mastery_node_options(params)
  if not build or not build.spec then return nil, 'build/spec not initialized' end
  local id = type(params) == 'table' and params.nodeId or nil
  if type(id) ~= 'number' or id < 1 or id ~= math.floor(id) or id >= math.huge then return nil, 'invalid mastery node ID' end
  local spec = build.spec
  local node = spec.nodes and spec.nodes[id]
  if not node or not (node.isMastery or node.type == 'Mastery') or type(node.masteryEffects) ~= 'table' then
    return nil, 'mastery node or options unavailable'
  end
  local effects = setmetatable({}, { __jsontype = 'array' })
  for _, entry in ipairs(node.masteryEffects) do
    if type(entry.effect) == 'number' then
      table.insert(effects, { effectId = entry.effect, stat = entry.stats and table.concat(entry.stats, ', ') or tostring(entry.effect) })
    end
  end
  return { nodeId = id, nodeName = node.name or 'Mastery', allocated = not not (spec.allocNodes and spec.allocNodes[id]),
    allocatedEffect = spec.masterySelections and spec.masterySelections[id] or nil,
    ascendancyName = node.ascendancyName, availableEffects = effects }
end


return M
