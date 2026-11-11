export type PassiveMinimums = { Life?: number; EnergyShield?: number };

export function validPassiveMinimums(value: unknown): value is PassiveMinimums {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, amount]) =>
    ['Life', 'EnergyShield'].includes(key) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0,
  );
}
