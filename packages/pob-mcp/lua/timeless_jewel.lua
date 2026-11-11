-- Enumerate Timeless Jewel seeds using PoB's authoritative LUT.  This is kept
-- in the headless API so MCP clients never need to ship or decode the LUT.
return function(params)
	params = params or {}
	local function validInt(value, min, max)
		return type(value) == 'number' and value == math.floor(value) and value >= min and value <= max
	end
	local socketId = params.socketNodeId
	local desired = params.desired or {}
	local limit = params.limit or 20
	if not validInt(socketId, 1, 2147483647) or not validInt(limit, 1, 100) then return { ok = false, error = 'invalid socketNodeId or limit' } end
	if not build or not build.spec or not build.spec.tree then return { ok = false, error = 'no build loaded' } end
	local tree = build.spec.tree
	local socket = tree.nodes[socketId]
	if not socket or not socket.nodesInRadius or not socket.nodesInRadius[3] then
		return { ok = false, error = 'invalid timeless jewel socket' }
	end
	if type(desired) ~= 'table' or #desired < 1 or #desired > 100 then return { ok = false, error = 'invalid desired nodes' } end
	local wanted = {}
	for _, entry in ipairs(desired) do
		if type(entry) ~= 'string' or #entry < 1 or #entry > 200 or wanted[entry] then return { ok = false, error = 'invalid or duplicate desired node' } end
		wanted[entry] = true
	end
	if not next(wanted) then return { ok = false, error = 'desired must contain one or more PoB legion node ids' } end
	if not tree.legion or type(tree.legion.nodes) ~= 'table' or type(tree.legion.additions) ~= 'table' then return { ok = false, error = 'timeless data unavailable for tree version' } end
	local known = {}
	for _, collection in ipairs({ tree.legion.nodes, tree.legion.additions }) do
		for _, node in pairs(collection) do if type(node) == 'table' and type(node.id) == 'string' then known[node.id] = true end end
	end
	for id in pairs(wanted) do if not known[id] then return { ok = false, error = 'unknown PoB timeless node id: ' .. id } end end
	local staticHits, staticScore = setmetatable({}, { __jsontype = 'array' }), 0
	-- Elegant Hubris keystones are selected by the historic figure, rather than
	-- by the seed LUT. Caspiro always converts a Keystone in radius to Supreme
	-- Ostentation; the caller supplies the particular original Keystone they use.
	if params.historicFigure ~= nil or params.keystoneNodeId ~= nil then
		if params.historicFigure ~= 'Caspiro' or not validInt(params.keystoneNodeId, 1, 2147483647) then return { ok = false, error = 'Caspiro and a keystoneNodeId must be supplied together' } end
		local keyNode = tree.nodes[params.keystoneNodeId]
		if not keyNode or not (keyNode.isKeystone or keyNode.type == 'Keystone') or not socket.nodesInRadius[3][params.keystoneNodeId] then return { ok = false, error = 'keystone is not in the selected jewel radius' } end
		if wanted['eternal_keystone_3_v2'] then
			table.insert(staticHits, { nodeId = params.keystoneNodeId, nodeName = keyNode.dn, id = 'eternal_keystone_3_v2', name = 'Supreme Ostentation', stats = { 'Ignore Attribute Requirements', 'Gain no inherent bonuses from Attributes' }, static = true, allocated = build.spec.allocNodes[params.keystoneNodeId] ~= nil })
			staticScore = 1
		end
	end
	local seeds = params.seeds
	if seeds ~= nil then
		if type(seeds) ~= 'table' or #seeds < 1 or #seeds > 8000 then return { ok = false, error = 'invalid seeds' } end
		local seen = {}
		for _, seed in ipairs(seeds) do
			if not validInt(seed, data.timelessJewelSeedMin[5] * 20, data.timelessJewelSeedMax[5] * 20) or seed % 20 ~= 0 or seen[seed] then return { ok = false, error = 'invalid or duplicate Elegant Hubris seed' } end
			seen[seed] = true
		end
	end
	local requiredNodes = {}
	if params.requiredSourceNodeIds ~= nil and (type(params.requiredSourceNodeIds) ~= 'table' or #params.requiredSourceNodeIds > 100) then return { ok = false, error = 'invalid required source nodes' } end
	for _, nodeId in ipairs(params.requiredSourceNodeIds or {}) do
		local node = validInt(nodeId, 1, 2147483647) and tree.nodes[nodeId]
		if not node or node.type ~= 'Notable' or not socket.nodesInRadius[3][nodeId] or requiredNodes[nodeId] then return { ok = false, error = 'invalid required notable in jewel radius' } end
		requiredNodes[nodeId] = true
	end
	local requireSpecificNode = next(requiredNodes) ~= nil
	local results, scanned = setmetatable({}, { __jsontype = 'array' }), 0
	local function scanSeed(seed)
		scanned = scanned + 1
		local hits, score, dynamicScore, matchedRequiredNode = setmetatable({}, { __jsontype = 'array' }), staticScore, 0, false
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
					table.insert(hits, { nodeId = nodeId, nodeName = node.dn, id = candidate.id, name = candidate.dn, stats = candidate.sd, allocated = build.spec.allocNodes[nodeId] ~= nil })
				end
			end
		end
		-- A historic figure's Keystone is shared by every seed; retain only seeds
		-- that additionally hit at least one seed-dependent desired notable.
		if dynamicScore > 0 and (not requireSpecificNode or matchedRequiredNode) then table.insert(results, { seed = seed, score = score, hits = hits }) end
	end
	if seeds then
		for _, seed in ipairs(seeds) do scanSeed(seed) end
	else
		for seed = data.timelessJewelSeedMin[5] * 20, data.timelessJewelSeedMax[5] * 20, 20 do scanSeed(seed) end
	end
	table.sort(results, function(a,b) return a.score > b.score or (a.score == b.score and a.seed < b.seed) end)
	local totalMatches = #results
	while #results > limit do table.remove(results) end
	return { ok = true, socketNodeId = socketId, treeVersion = build.spec.treeVersion, jewelType = 'Elegant Hubris', scannedSeeds = scanned, totalMatches = totalMatches, results = results }
end
