export const PUBLIC_SITE_SETTINGS_KEY = 'public_site';

export type PublicHeroSettings = {
  eyebrow: string;
  title: string;
  description: string;
  imageUrl: string;
};

export type PublicMarketRate = {
  id: string;
  currencyName: string;
  currencyCode: string;
  priceType: string;
  value: string;
  unit: string;
  updatedAt: string;
  isActive: boolean;
  order: number;
};

export type PublicService = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  link: string;
  platforms: string[];
  isActive: boolean;
  order: number;
};

export type PublicBank = {
  id: string;
  name: string;
  logoUrl: string;
  colorFrom: string;
  colorTo: string;
  isActive: boolean;
  order: number;
};

export type PublicTransferAccount = {
  id: string;
  bankName: string;
  ownerName: string;
  accountNumber: string;
  iban: string;
  currency: string;
  country: string;
  qrValue: string;
  directUrl: string;
  isActive: boolean;
  order: number;
};

export type PublicContactSettings = {
  phone: string;
  phoneDisplay: string;
  whatsappNumber: string;
  facebookUrl: string;
  address: string;
  mapsUrl: string;
};

export type PublicSiteSettings = {
  hero: PublicHeroSettings;
  marketRates: PublicMarketRate[];
  services: PublicService[];
  banks: PublicBank[];
  transferAccounts: PublicTransferAccount[];
  contact: PublicContactSettings;
  trustSignals: string[];
  reasons: string[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = '') {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function numericValue(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function orderValue(value: unknown, fallback: number) {
  return Math.max(0, Math.round(numericValue(value, fallback)));
}

function dateValue(value: unknown, fallback: string) {
  const text = stringValue(value, '');
  if (!text) return fallback;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function arrayValue(value: unknown, fallback: string[]) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => stringValue(item)).filter(Boolean).slice(0, 12);
}

function recordAt(value: unknown, fallback: UnknownRecord = {}) {
  return isRecord(value) ? value : fallback;
}

function sortByOrder<T extends { order: number }>(items: T[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

export function createDefaultPublicSiteSettings(now = new Date()): PublicSiteSettings {
  const updatedAt = now.toISOString();
  const whatsappNumber = '218935095091';

  return {
    hero: {
      eyebrow: 'ELWASEET ELALAMY',
      title: 'الوسيط العالمي للدفع الإلكتروني والحوالات',
      description: 'حلول مالية متكاملة للدفع والتحويل وشراء العملات والخدمات الإلكترونية محليًا ودوليًا.',
      imageUrl: '/brand/global-payments-hero.png',
    },
    marketRates: [
      {
        id: 'usd-cash',
        currencyName: 'الدولار',
        currencyCode: 'USD',
        priceType: 'كاش',
        value: '9.32',
        unit: 'د.ل',
        updatedAt,
        isActive: true,
        order: 1,
      },
      {
        id: 'usd-bank',
        currencyName: 'الدولار',
        currencyCode: 'USD',
        priceType: 'حوالة بنكية',
        value: '9.55',
        unit: 'د.ل',
        updatedAt,
        isActive: true,
        order: 2,
      },
      {
        id: 'eur',
        currencyName: 'اليورو',
        currencyCode: 'EUR',
        priceType: 'سعر السوق',
        value: '10',
        unit: 'د.ل',
        updatedAt,
        isActive: true,
        order: 3,
      },
      {
        id: 'gbp',
        currencyName: 'الجنيه الإسترليني',
        currencyCode: 'GBP',
        priceType: 'سعر السوق',
        value: '11',
        unit: 'د.ل',
        updatedAt,
        isActive: true,
        order: 4,
      },
      {
        id: 'cny',
        currencyName: 'اليوان الصيني',
        currencyCode: 'CNY',
        priceType: 'سعر السوق',
        value: '6.7',
        unit: '',
        updatedAt,
        isActive: true,
        order: 5,
      },
    ],
    services: [
      {
        id: 'usdt',
        title: 'شراء وبيع USDT',
        description: 'شراء وبيع USDT بأسعار تنافسية وتنفيذ سريع وآمن.',
        imageUrl: '/brand/usdt-service.png',
        link: '#contact',
        platforms: ['USDT', 'TRC20', 'محافظ رقمية'],
        isActive: true,
        order: 1,
      },
      {
        id: 'shein-cards',
        title: 'بيع وشراء بطاقات SHEIN',
        description: 'بطاقات ومشتريات رقمية للتجارة الإلكترونية بمتابعة واضحة وتنفيذ موثوق.',
        imageUrl: '/brand/commerce-cards-service.png',
        link: '#contact',
        platforms: ['Gift Cards', 'Shopping UI', 'Online purchase'],
        isActive: true,
        order: 2,
      },
      {
        id: 'global-invoices',
        title: 'دفع فواتير المواقع العالمية',
        description: 'دفع فواتير ومشتريات المواقع والمتاجر الإلكترونية العالمية بسهولة وأمان.',
        imageUrl: '/brand/commerce-cards-service.png',
        link: '#contact',
        platforms: ['متاجر عالمية', 'فواتير', 'مدفوعات آمنة'],
        isActive: true,
        order: 3,
      },
      {
        id: 'china-payments',
        title: 'دفع جميع فواتير الصين',
        description: 'دفع فواتير الصين فقط، بدون خدمة شحن، مع متابعة واضحة للطلب لحظة بلحظة.',
        imageUrl: '/brand/china-payments.png',
        link: '#contact',
        platforms: ['Taobao', 'Tmall', '1688', 'Alibaba', 'Pinduoduo', 'Alipay', 'WeChat Pay'],
        isActive: true,
        order: 4,
      },
      {
        id: 'facebook-wallets',
        title: 'شحن محافظ وإعلانات Facebook',
        description: 'شحن محافظ وإعلانات Facebook وتنفيذ مدفوعات الحملات الرقمية بسرعة وأمان.',
        imageUrl: '/brand/commerce-cards-service.png',
        link: '#contact',
        platforms: ['Ads', 'Wallets', 'Meta'],
        isActive: true,
        order: 5,
      },
      {
        id: 'remittances',
        title: 'حوالات مالية محلية ودولية',
        description: 'حلول تحويل مرنة للأفراد والأعمال مع متابعة دقيقة وسرعة في الإنجاز.',
        imageUrl: '/brand/global-payments-hero.png',
        link: '#contact',
        platforms: ['محلي', 'دولي', 'أعمال'],
        isActive: true,
        order: 6,
      },
      {
        id: 'travel',
        title: 'الحجوزات وخدمات السفر',
        description: 'مساندة مالية منظمة للحجوزات وخدمات السفر عند توفر الخدمة.',
        imageUrl: '/brand/global-payments-hero.png',
        link: '#contact',
        platforms: ['طيران', 'فنادق', 'حجوزات'],
        isActive: true,
        order: 7,
      },
    ],
    banks: [
      {
        id: 'jumhouria',
        name: 'مصرف الجمهورية',
        logoUrl: '',
        colorFrom: '#0b3b8c',
        colorTo: '#13a8ff',
        isActive: true,
        order: 1,
      },
      {
        id: 'wahda',
        name: 'مصرف الوحدة',
        logoUrl: '',
        colorFrom: '#075985',
        colorTo: '#14b8a6',
        isActive: true,
        order: 2,
      },
      {
        id: 'north-africa',
        name: 'مصرف شمال أفريقيا',
        logoUrl: '',
        colorFrom: '#111f4d',
        colorTo: '#2563eb',
        isActive: true,
        order: 3,
      },
      {
        id: 'development',
        name: 'مصرف التنمية',
        logoUrl: '',
        colorFrom: '#172554',
        colorTo: '#0ea5e9',
        isActive: true,
        order: 4,
      },
    ],
    transferAccounts: [
      {
        id: 'north-bank-hussam',
        bankName: 'مصرف الشمال',
        ownerName: 'حسام قدارة',
        accountNumber: 'LY89007014014011178252019',
        iban: 'LY89007014014011178252019',
        currency: 'LYD',
        country: 'ليبيا',
        qrValue: 'LY89007014014011178252019',
        directUrl: `https://wa.me/${whatsappNumber}?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%20%D8%AD%D8%B3%D8%A7%D8%A8%20%D8%A7%D9%84%D8%AA%D8%AD%D9%88%D9%8A%D9%84`,
        isActive: true,
        order: 1,
      },
    ],
    contact: {
      phone: '+218935095091',
      phoneDisplay: '+218 93-5095091',
      whatsappNumber,
      facebookUrl: 'https://www.facebook.com/profile.php?id=61560408535771',
      address: 'زناتة مقابل كيان موبايل – طرابلس، ليبيا',
      mapsUrl: 'https://maps.app.goo.gl/K1AXMq7voiRBfzTb6',
    },
    trustSignals: ['دفع آمن وموثوق', 'إنجاز سريع', 'متابعة طلبك لحظة بلحظة', 'أسعار مناسبة وخدمة مميزة'],
    reasons: ['خبرة في خدمات الدفع الدولية', 'وضوح في الأسعار والحسابات', 'قنوات تواصل مباشرة', 'تنفيذ منظم للأفراد والأعمال'],
  };
}

function normalizeHero(value: unknown, fallback: PublicHeroSettings): PublicHeroSettings {
  const record = recordAt(value);
  return {
    eyebrow: stringValue(record.eyebrow, fallback.eyebrow),
    title: stringValue(record.title, fallback.title),
    description: stringValue(record.description, fallback.description),
    imageUrl: stringValue(record.imageUrl, fallback.imageUrl),
  };
}

function normalizeMarketRates(value: unknown, fallback: PublicMarketRate[]): PublicMarketRate[] {
  const source = Array.isArray(value) ? value : fallback;
  const fallbackByIndex = fallback[0];

  return sortByOrder(
    source.slice(0, 40).map((item, index) => {
      const record = recordAt(item);
      const base = fallback[index] || fallbackByIndex;
      return {
        id: stringValue(record.id, `rate-${index + 1}`),
        currencyName: stringValue(record.currencyName, base.currencyName),
        currencyCode: stringValue(record.currencyCode, base.currencyCode).toUpperCase(),
        priceType: stringValue(record.priceType, base.priceType),
        value: stringValue(record.value, base.value),
        unit: stringValue(record.unit, base.unit),
        updatedAt: dateValue(record.updatedAt, base.updatedAt),
        isActive: boolValue(record.isActive, base.isActive),
        order: orderValue(record.order, index + 1),
      };
    }),
  );
}

function normalizeServices(value: unknown, fallback: PublicService[]): PublicService[] {
  const source = Array.isArray(value) ? value : fallback;
  const fallbackByIndex = fallback[0];

  return sortByOrder(
    source.slice(0, 30).map((item, index) => {
      const record = recordAt(item);
      const base = fallback[index] || fallbackByIndex;
      return {
        id: stringValue(record.id, `service-${index + 1}`),
        title: stringValue(record.title, base.title),
        description: stringValue(record.description, base.description),
        imageUrl: stringValue(record.imageUrl, base.imageUrl),
        link: stringValue(record.link, base.link),
        platforms: arrayValue(record.platforms, base.platforms),
        isActive: boolValue(record.isActive, base.isActive),
        order: orderValue(record.order, index + 1),
      };
    }),
  );
}

function normalizeBanks(value: unknown, fallback: PublicBank[]): PublicBank[] {
  const source = Array.isArray(value) ? value : fallback;
  const fallbackByIndex = fallback[0];

  return sortByOrder(
    source.slice(0, 30).map((item, index) => {
      const record = recordAt(item);
      const base = fallback[index] || fallbackByIndex;
      return {
        id: stringValue(record.id, `bank-${index + 1}`),
        name: stringValue(record.name, base.name),
        logoUrl: stringValue(record.logoUrl, base.logoUrl),
        colorFrom: stringValue(record.colorFrom, base.colorFrom),
        colorTo: stringValue(record.colorTo, base.colorTo),
        isActive: boolValue(record.isActive, base.isActive),
        order: orderValue(record.order, index + 1),
      };
    }),
  );
}

function normalizeTransferAccounts(value: unknown, fallback: PublicTransferAccount[]): PublicTransferAccount[] {
  const source = Array.isArray(value) ? value : fallback;
  const fallbackByIndex = fallback[0];

  return sortByOrder(
    source.slice(0, 20).map((item, index) => {
      const record = recordAt(item);
      const base = fallback[index] || fallbackByIndex;
      const iban = stringValue(record.iban, base.iban);
      const accountNumber = stringValue(record.accountNumber, base.accountNumber || iban);
      return {
        id: stringValue(record.id, `account-${index + 1}`),
        bankName: stringValue(record.bankName, base.bankName),
        ownerName: stringValue(record.ownerName, base.ownerName),
        accountNumber,
        iban,
        currency: stringValue(record.currency, base.currency).toUpperCase(),
        country: stringValue(record.country, base.country),
        qrValue: stringValue(record.qrValue, iban || accountNumber),
        directUrl: stringValue(record.directUrl, base.directUrl),
        isActive: boolValue(record.isActive, base.isActive),
        order: orderValue(record.order, index + 1),
      };
    }),
  );
}

function normalizeContact(value: unknown, fallback: PublicContactSettings): PublicContactSettings {
  const record = recordAt(value);
  return {
    phone: stringValue(record.phone, fallback.phone),
    phoneDisplay: stringValue(record.phoneDisplay, fallback.phoneDisplay),
    whatsappNumber: stringValue(record.whatsappNumber, fallback.whatsappNumber).replace(/[^\d]/g, ''),
    facebookUrl: stringValue(record.facebookUrl, fallback.facebookUrl),
    address: stringValue(record.address, fallback.address),
    mapsUrl: stringValue(record.mapsUrl, fallback.mapsUrl),
  };
}

export function normalizePublicSiteSettings(value: unknown, fallback = createDefaultPublicSiteSettings()): PublicSiteSettings {
  const record = recordAt(value);

  return {
    hero: normalizeHero(record.hero, fallback.hero),
    marketRates: normalizeMarketRates(record.marketRates, fallback.marketRates),
    services: normalizeServices(record.services, fallback.services),
    banks: normalizeBanks(record.banks, fallback.banks),
    transferAccounts: normalizeTransferAccounts(record.transferAccounts, fallback.transferAccounts),
    contact: normalizeContact(record.contact, fallback.contact),
    trustSignals: arrayValue(record.trustSignals, fallback.trustSignals),
    reasons: arrayValue(record.reasons, fallback.reasons),
  };
}

export function applyMarketUpdatedAt(
  incoming: PublicSiteSettings,
  previous: PublicSiteSettings,
  now = new Date(),
): PublicSiteSettings {
  const timestamp = now.toISOString();
  const previousRates = new Map(previous.marketRates.map((rate) => [rate.id, rate]));

  return {
    ...incoming,
    marketRates: incoming.marketRates.map((rate) => {
      const previousRate = previousRates.get(rate.id);
      if (!previousRate) return { ...rate, updatedAt: rate.updatedAt || timestamp };
      if (previousRate.value !== rate.value || previousRate.unit !== rate.unit || previousRate.priceType !== rate.priceType) {
        return { ...rate, updatedAt: timestamp };
      }
      return { ...rate, updatedAt: previousRate.updatedAt };
    }),
  };
}
