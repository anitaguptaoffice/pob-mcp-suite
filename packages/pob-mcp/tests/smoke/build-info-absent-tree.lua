-- An initialized build can have a target version without an observable spec.
-- Neither build metadata nor calculated-stat metadata should label it a tree.
local ops = dofile('lua/pob_ops.lua')
build = { targetVersion = '3_0', characterLevel = 10, calcsTab = { mainOutput = { Life = 123 } } }
local info = assert(ops.get_build_info())
assert(info.targetVersion == '3_0')
assert(info.treeVersion == nil)
local stats = assert(ops.export_stats({ 'Life' }))
assert(stats.Life == 123 and stats._meta.targetVersion == '3_0')
assert(stats._meta.treeVersion == nil)
print('build metadata leaves missing tree version unknown')
