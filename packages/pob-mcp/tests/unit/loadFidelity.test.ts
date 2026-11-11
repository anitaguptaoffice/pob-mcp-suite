import { verifyLoadedTree } from '../../src/adapters/pob/loadFidelity.js';

const xml = '<PathOfBuilding><Tree activeSpec="2"><Spec treeVersion="old" nodes="9"/><Spec treeVersion="3_29" nodes="1,2" masteryEffects="{2,7}"/></Tree></PathOfBuilding>';
const actual = { treeVersion: '3_29', nodes: [1, 2, 3], masteryEffects: { '2': 7 } };

it('checks the active saved tree, allows implicit starting nodes and leaves source XML unchanged', async () => {
  const read = jest.fn(async () => actual);
  await verifyLoadedTree(xml, read);
  expect(read).toHaveBeenCalledTimes(1);
});

it('refuses dropped nodes, substituted tree versions and lost mastery selections', async () => {
  await expect(verifyLoadedTree(xml, async () => ({ ...actual, nodes: [1] }))).rejects.toThrow('dropped 1 saved passive');
  await expect(verifyLoadedTree(xml, async () => ({ ...actual, treeVersion: '3_28' }))).rejects.toThrow('changed the saved tree version');
  await expect(verifyLoadedTree(xml, async () => ({ ...actual, masteryEffects: {} }))).rejects.toThrow('changed the saved mastery');
});

it('does not invent a tree requirement when source XML omits it', async () => {
  const read = jest.fn();
  await verifyLoadedTree('<PathOfBuilding/>', read);
  expect(read).not.toHaveBeenCalled();
});
