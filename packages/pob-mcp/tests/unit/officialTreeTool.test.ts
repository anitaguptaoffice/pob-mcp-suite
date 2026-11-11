import { createOfficialTreeTool } from '../../src/features/officialTree/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { OfficialTreeCode } from '../../src/ports/officialTreeCode.js';

const id = 'a'.repeat(64), child = 'b'.repeat(64);
const decoded: OfficialTreeCode = { formatVersion: 6, classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [42], masteryEffects: {}, treeVersion: null, startNodesInferred: false };
const args = { snapshot_id: id, code: 'test', tree_version: '3_29' };
function setup() {
  const resolveTreeStartingNodes = jest.fn().mockResolvedValue({ identity: {}, warnings: [], nodes: [1] });
  const deriveTreeReplacement = jest.fn().mockResolvedValue({ id: child, parentId: id, xml: '<private/>' });
  const decode = jest.fn(() => decoded);
  const tool = createOfficialTreeTool({ resolveTreeStartingNodes, deriveTreeReplacement } as unknown as Pick<BuildFoundation, 'resolveTreeStartingNodes' | 'deriveTreeReplacement'>, decode);
  return { decode, resolveTreeStartingNodes, deriveTreeReplacement, tool };
}
it('confirms every decoded node in PoB before deriving a trial child', async () => {
  const t = setup();
  const result = JSON.parse((await t.tool.invoke(args)).content[0].text);
  expect(result.snapshot).toMatchObject({ id: child, parentId: id }); expect(result.snapshot.xml).toBeUndefined();
  expect(t.deriveTreeReplacement).toHaveBeenCalledWith(id, { classId: 3, ascendClassId: 0, secondaryAscendClassId: 0, treeVersion: '3_29', nodes: [1, 42], masteryEffects: {} }, true, 'reject');
});
it('does not derive if starting-node resolution fails or options are invalid', async () => {
  const overridden = setup(); overridden.resolveTreeStartingNodes.mockRejectedValue(new Error('node overrides'));
  await expect(overridden.tool.invoke(args)).rejects.toThrow('node overrides'); expect(overridden.deriveTreeReplacement).not.toHaveBeenCalled();
  const invalid = setup(); await expect(invalid.tool.invoke({ ...args, tree_version: 'latest' })).rejects.toThrow('Invalid'); expect(invalid.resolveTreeStartingNodes).not.toHaveBeenCalled();
});
