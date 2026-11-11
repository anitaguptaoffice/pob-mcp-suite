import { craftBudgetSchemas, handleCraftBudget } from '../features/craftBudget/tool.js';
import { craftSimulatorSchemas, handleSimpleAnnul } from '../features/craftSimulator/tool.js';
import { FeatureRegistry } from './featureRegistry.js';

// Stateless tools that need no shared client. Capability-gated groups are
// registered by the composition root in src/index.ts.
export const featureRegistry = new FeatureRegistry([
  { schema: craftBudgetSchemas()[0], invoke: handleCraftBudget },
  { schema: craftSimulatorSchemas()[0], invoke: handleSimpleAnnul },
]);
