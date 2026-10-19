import { describe, expect, it } from 'vitest';
import {
  applyMarketUpdatedAt,
  createDefaultPublicSiteSettings,
  normalizePublicSiteSettings,
} from '@/lib/public-site-data';

describe('public site settings data', () => {
  it('ships market defaults as editable data outside React components', () => {
    const settings = createDefaultPublicSiteSettings(new Date('2026-09-08T00:30:00.000Z'));

    expect(settings.marketRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currencyCode: 'USD', priceType: 'كاش', value: '9.32', isActive: true }),
        expect.objectContaining({ currencyCode: 'USD', priceType: 'حوالة بنكية', value: '9.55', isActive: true }),
        expect.objectContaining({ currencyCode: 'EUR', value: '10', isActive: true }),
        expect.objectContaining({ currencyCode: 'GBP', value: '11', isActive: true }),
        expect.objectContaining({ currencyCode: 'CNY', value: '6.7', isActive: true }),
      ]),
    );
  });

  it('normalizes active flags and ordering for public lists', () => {
    const normalized = normalizePublicSiteSettings({
      services: [
        { id: 'second', title: 'ثانية', description: 'وصف', imageUrl: '/x.png', order: 2, isActive: false },
        { id: 'first', title: 'أولى', description: 'وصف', imageUrl: '/y.png', order: 1, isActive: true },
      ],
      banks: [{ id: 'bank', name: 'مصرف', colorFrom: '#000000', colorTo: '#ffffff', order: 4, isActive: false }],
    });

    expect(normalized.services.map((service) => service.id)).toEqual(['first', 'second']);
    expect(normalized.services[1].isActive).toBe(false);
    expect(normalized.banks[0]).toEqual(expect.objectContaining({ name: 'مصرف', isActive: false, order: 4 }));
  });

  it('updates market timestamps only when the displayed price fields change', () => {
    const previous = createDefaultPublicSiteSettings(new Date('2026-09-08T00:30:00.000Z'));
    const incoming = normalizePublicSiteSettings(
      {
        ...previous,
        marketRates: previous.marketRates.map((rate) =>
          rate.id === 'usd-cash' ? { ...rate, value: '9.40' } : { ...rate, isActive: !rate.isActive },
        ),
      },
      previous,
    );

    const saved = applyMarketUpdatedAt(incoming, previous, new Date('2026-09-08T01:00:00.000Z'));

    expect(saved.marketRates.find((rate) => rate.id === 'usd-cash')?.updatedAt).toBe('2026-09-08T01:00:00.000Z');
    expect(saved.marketRates.find((rate) => rate.id === 'usd-bank')?.updatedAt).toBe('2026-09-08T00:30:00.000Z');
  });
});
