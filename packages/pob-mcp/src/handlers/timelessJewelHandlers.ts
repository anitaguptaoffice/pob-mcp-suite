import { wrapHandler } from "../utils/errorHandling.js";

export async function handleFindTimelessJewelSeeds(
  luaClient: any,
  args: { socket_node_id: number; desired_node_ids: string[]; limit?: number; seeds?: number[]; historic_figure?: string; keystone_node_id?: number; required_source_node_ids?: number[] },
) {
  return wrapHandler("find timeless jewel seeds", async () => {
    if (!luaClient) throw new Error("Lua bridge not active. Use lua_load_build first.");
    const result = await luaClient.findTimelessJewelSeeds({
      socketNodeId: args.socket_node_id,
      desired: args.desired_node_ids,
      limit: args.limit,
      seeds: args.seeds,
      historicFigure: args.historic_figure,
      keystoneNodeId: args.keystone_node_id,
      requiredSourceNodeIds: args.required_source_node_ids,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
