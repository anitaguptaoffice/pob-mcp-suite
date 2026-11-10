import { craftBudgetSchemas, handleCraftBudget } from '../features/craftBudget/tool.js';
import { craftSimulatorSchemas, handleSimpleAnnul } from '../features/craftSimulator/tool.js';
import { FeatureRegistry } from './featureRegistry.js';

// First migration: these tools are always available and require no shared clients.
// Capability-gated modules remain on the legacy path until their contracts migrate.
export const featureRegistry = new FeatureRegistry([
  { schema: craftBudgetSchemas()[0], invoke: handleCraftBudget },
  { schema: craftSimulatorSchemas()[0], invoke: handleSimpleAnnul },
]);
