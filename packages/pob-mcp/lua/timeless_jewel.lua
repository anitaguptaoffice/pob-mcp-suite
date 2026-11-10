-- Enumerate Timeless Jewel seeds using PoB's authoritative LUT.  This is kept
-- in the headless API so MCP clients never need to ship or decode the LUT.
return function(params)
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
