export interface OfficialTreeCode {
  formatVersion: number;
  classId: number;
  ascendClassId: number;
  secondaryAscendClassId: number;
  nodes: number[];
  masteryEffects: Record<string, number>;
  treeVersion: null;
  startNodesInferred: false;
}
