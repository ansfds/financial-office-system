import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  PUBLIC_SITE_SETTINGS_KEY,
  applyMarketUpdatedAt,
  createDefaultPublicSiteSettings,
  normalizePublicSiteSettings,
  type PublicSiteSettings,
} from '@/lib/public-site-data';

function toJson(settings: PublicSiteSettings) {
  return settings as unknown as Prisma.InputJsonValue;
}

export async function getPublicSiteSettings({ persistDefaults = false } = {}) {
  const row = await db.systemSetting.findUnique({ where: { key: PUBLIC_SITE_SETTINGS_KEY } });

  if (row) return normalizePublicSiteSettings(row.value);

  const defaults = createDefaultPublicSiteSettings();
  if (persistDefaults) {
    await db.systemSetting.create({
      data: {
        key: PUBLIC_SITE_SETTINGS_KEY,
        value: toJson(defaults),
      },
    });
  }

  return defaults;
}

export async function savePublicSiteSettings(value: unknown) {
  const previous = await getPublicSiteSettings({ persistDefaults: true });
  const incoming = normalizePublicSiteSettings(value, previous);
  const settings = applyMarketUpdatedAt(incoming, previous);

  await db.systemSetting.upsert({
    where: { key: PUBLIC_SITE_SETTINGS_KEY },
    create: {
      key: PUBLIC_SITE_SETTINGS_KEY,
      value: toJson(settings),
    },
    update: {
      value: toJson(settings),
    },
  });

  return settings;
}
