export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/legacyRuntime.js')) throw new Error('LEGACY_RUNTIME_IMPORT_BLOCKED');
  return nextResolve(specifier, context);
}
