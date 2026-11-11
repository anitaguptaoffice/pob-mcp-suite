export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/legacyRuntime.js')) throw new Error('LEGACY_RUNTIME_IMPORT_BLOCKED');
  const result = await nextResolve(specifier, context);
  if (/\/build\/(?:services|handlers)\//.test(result.url) || /\/build\/(?:pobLuaBridge|server\/(?:toolRouter|toolSchemas)|features\/(?:buildCost|tradeComparable)\/tool)\.js$/.test(result.url)) throw new Error(`LEGACY_MODULE_IMPORT_BLOCKED: ${result.url}`);
  return result;
}
