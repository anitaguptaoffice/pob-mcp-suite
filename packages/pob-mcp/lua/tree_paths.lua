-- Read the current PassiveSpec's native pathfinding results, without changing it.
return function(params)
  if not build or not build.spec or not build.spec.nodes then return nil, 'build/spec not initialized' end
  local spec = build.spec
  if type(params) ~= 'table' then return nil, 'invalid path options' end
  local function integer(value, min, max)
    return type(value) == 'number' and value == math.floor(value) and value >= min and value <= max
  end
  local function describe(node)
    local allocated = spec.allocNodes and spec.allocNodes[node.id] ~= nil or false
    local path = setmetatable({}, { __jsontype = 'array' })
    local reachable = not allocated and type(node.path) == 'table' and type(node.pathDist) == 'number' and node.pathDist < 1000
    if reachable then
      for index = #node.path, 1, -1 do
        local step = node.path[index]
        if step and not step.alloc and step.id then table.insert(path, step.id) end
      end
      if #path == 0 or path[#path] ~= node.id or #path ~= node.pathDist then reachable = false end
    end
    local stats = setmetatable({}, { __jsontype = 'array' })
    for _, line in ipairs(node.sd or {}) do if type(line) == 'string' then table.insert(stats, line) end end
    return { id = node.id, name = node.name or 'Unnamed', type = node.isKeystone and 'keystone' or node.isNotable and 'notable' or node.isJewelSocket and 'jewel' or (node.isMastery or node.type == 'Mastery') and 'mastery' or node.ascendancyName and 'ascendancy' or 'normal',
      ascendancyName = node.ascendancyName, isBlighted = node.isBlighted == true, stats = stats, allocated = allocated,
      status = allocated and 'allocated' or reachable and 'reachable' or 'unreachable', pathNodes = reachable and path or setmetatable({}, { __jsontype = 'array' }), pointCost = reachable and #path or allocated and 0 or nil }
  end
  if params.targetNodeId ~= nil then
    if not integer(params.targetNodeId, 1, 2147483647) then return nil, 'invalid target node ID' end
    local node = spec.nodes[params.targetNodeId]
    return { treeVersion = spec.treeVersion, mode = 'target', targetNodeId = params.targetNodeId, node = node and describe(node) or nil, status = node and 'found' or 'not_found' }
  end
  local maxDistance, limit, filter = params.maxDistance or 3, params.limit or 30, params.filter or ''
  if not integer(maxDistance, 1, 100) or not integer(limit, 1, 100) or type(filter) ~= 'string' or #filter > 800 then return nil, 'invalid nearby options' end
  filter = filter:lower()
  local candidates = setmetatable({}, { __jsontype = 'array' })
  for _, node in pairs(spec.nodes) do
    if (node.isKeystone or node.isNotable) and not node.alloc then
      local entry = describe(node)
      if entry.status == 'reachable' and entry.pointCost <= maxDistance then
        local match = filter == '' or entry.name:lower():find(filter, 1, true) ~= nil
        if not match then for _, stat in ipairs(entry.stats) do if stat:lower():find(filter, 1, true) then match = true break end end end
        if match then table.insert(candidates, entry) end
      end
    end
  end
  table.sort(candidates, function(a, b) return a.pointCost < b.pointCost or (a.pointCost == b.pointCost and a.id < b.id) end)
  local total = #candidates
  while #candidates > limit do table.remove(candidates) end
  return { treeVersion = spec.treeVersion, mode = 'nearby', maxDistance = maxDistance, total = total, nodes = candidates }
end
