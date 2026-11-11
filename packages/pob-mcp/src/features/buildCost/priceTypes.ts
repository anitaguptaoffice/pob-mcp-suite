export interface PriceLine {
  name: string;
  baseType?: string;
  chaosValue: number;
  listingCount?: number;
  count?: number;
  gemLevel?: number;
  gemQuality?: number;
  corrupted?: boolean;
  variant?: string;
  links?: number;
  explicitModifiers?: Array<{ optional?: boolean }>;
}

export type PriceCategory = 'UniqueWeapon' | 'UniqueArmour' | 'UniqueAccessory' | 'UniqueFlask' | 'UniqueJewel' | 'SkillGem';
export interface PriceSnapshot { lines: PriceLine[]; fetchedAt: string }
