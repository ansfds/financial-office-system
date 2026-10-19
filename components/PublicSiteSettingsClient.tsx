'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  PublicBank,
  PublicMarketRate,
  PublicService,
  PublicSiteSettings,
  PublicTransferAccount,
} from '@/lib/public-site-data';

type TabKey = 'market' | 'services' | 'banks' | 'accounts' | 'contact' | 'identity';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'market', label: 'تحديثات السوق' },
  { key: 'services', label: 'الخدمات' },
  { key: 'banks', label: 'البنوك' },
  { key: 'accounts', label: 'حسابات التحويل' },
  { key: 'contact', label: 'التواصل' },
  { key: 'identity', label: 'الهوية' },
];

function newId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}`;
}

function splitList(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(value: string[]) {
  return value.join('\n');
}

export default function PublicSiteSettingsClient({ initialSettings }: { initialSettings: PublicSiteSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [activeTab, setActiveTab] = useState<TabKey>('market');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const response = await fetch('/api/settings/public-site', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(settings),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      toast.error(result.error || 'تعذر حفظ إعدادات الموقع العام');
      return;
    }

    setSettings(result.settings);
    toast.success('تم حفظ إعدادات الموقع العام');
    router.refresh();
  }

  function updateMarket(index: number, patch: Partial<PublicMarketRate>) {
    setSettings((current) => ({
      ...current,
      marketRates: current.marketRates.map((rate, rateIndex) => (rateIndex === index ? { ...rate, ...patch } : rate)),
    }));
  }

  function updateService(index: number, patch: Partial<PublicService>) {
    setSettings((current) => ({
      ...current,
      services: current.services.map((service, serviceIndex) =>
        serviceIndex === index ? { ...service, ...patch } : service,
      ),
    }));
  }

  function updateBank(index: number, patch: Partial<PublicBank>) {
    setSettings((current) => ({
      ...current,
      banks: current.banks.map((bank, bankIndex) => (bankIndex === index ? { ...bank, ...patch } : bank)),
    }));
  }

  function updateAccount(index: number, patch: Partial<PublicTransferAccount>) {
    setSettings((current) => ({
      ...current,
      transferAccounts: current.transferAccounts.map((account, accountIndex) =>
        accountIndex === index ? { ...account, ...patch } : account,
      ),
    }));
  }

  function removeFromList(key: 'marketRates' | 'services' | 'banks' | 'transferAccounts', index: number) {
    setSettings((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  }

  function addMarketRate() {
    setSettings((current) => ({
      ...current,
      marketRates: [
        ...current.marketRates,
        {
          id: newId('rate'),
          currencyName: 'عملة جديدة',
          currencyCode: 'NEW',
          priceType: 'سعر السوق',
          value: '0',
          unit: 'د.ل',
          updatedAt: new Date().toISOString(),
          isActive: true,
          order: current.marketRates.length + 1,
        },
      ],
    }));
  }

  function addService() {
    setSettings((current) => ({
      ...current,
      services: [
        ...current.services,
        {
          id: newId('service'),
          title: 'خدمة جديدة',
          description: 'وصف الخدمة',
          imageUrl: '/brand/global-payments-hero.png',
          link: '#contact',
          platforms: [],
          isActive: true,
          order: current.services.length + 1,
        },
      ],
    }));
  }

  function addBank() {
    setSettings((current) => ({
      ...current,
      banks: [
        ...current.banks,
        {
          id: newId('bank'),
          name: 'مصرف جديد',
          logoUrl: '',
          colorFrom: '#0b3b8c',
          colorTo: '#13a8ff',
          isActive: true,
          order: current.banks.length + 1,
        },
      ],
    }));
  }

  function addAccount() {
    setSettings((current) => ({
      ...current,
      transferAccounts: [
        ...current.transferAccounts,
        {
          id: newId('account'),
          bankName: 'مصرف جديد',
          ownerName: '',
          accountNumber: '',
          iban: '',
          currency: 'LYD',
          country: 'ليبيا',
          qrValue: '',
          directUrl: '',
          isActive: true,
          order: current.transferAccounts.length + 1,
        },
      ],
    }));
  }

  return (
    <section className="card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-black">إعدادات الموقع العام</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            تعديل أسعار السوق والخدمات والبنوك والحسابات وبيانات التواصل الظاهرة للزوار.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-950"
          >
            <Eye size={18} />
            معاينة الموقع
          </a>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            حفظ
          </button>
        </div>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black ${
              activeTab === tab.key
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {activeTab === 'market' ? (
          <EditableList title="تحديثات السوق" onAdd={addMarketRate}>
            {settings.marketRates.map((rate, index) => (
              <div key={rate.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="grid gap-3 md:grid-cols-6">
                  <Field label="اسم العملة">
                    <input value={rate.currencyName} onChange={(event) => updateMarket(index, { currencyName: event.target.value })} />
                  </Field>
                  <Field label="الرمز">
                    <input
                      dir="ltr"
                      value={rate.currencyCode}
                      onChange={(event) => updateMarket(index, { currencyCode: event.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="نوع السعر">
                    <input value={rate.priceType} onChange={(event) => updateMarket(index, { priceType: event.target.value })} />
                  </Field>
                  <Field label="القيمة">
                    <input dir="ltr" value={rate.value} onChange={(event) => updateMarket(index, { value: event.target.value })} />
                  </Field>
                  <Field label="الوحدة">
                    <input value={rate.unit} onChange={(event) => updateMarket(index, { unit: event.target.value })} />
                  </Field>
                  <Field label="الترتيب">
                    <input
                      type="number"
                      value={rate.order}
                      onChange={(event) => updateMarket(index, { order: Number(event.target.value) })}
                    />
                  </Field>
                </div>
                <RowActions
                  active={rate.isActive}
                  onToggle={(isActive) => updateMarket(index, { isActive })}
                  onDelete={() => removeFromList('marketRates', index)}
                />
              </div>
            ))}
          </EditableList>
        ) : null}

        {activeTab === 'services' ? (
          <EditableList title="الخدمات" onAdd={addService}>
            {settings.services.map((service, index) => (
              <div key={service.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="اسم الخدمة">
                    <input value={service.title} onChange={(event) => updateService(index, { title: event.target.value })} />
                  </Field>
                  <Field label="رابط الخدمة">
                    <input dir="ltr" value={service.link} onChange={(event) => updateService(index, { link: event.target.value })} />
                  </Field>
                  <Field label="الصورة">
                    <input
                      dir="ltr"
                      value={service.imageUrl}
                      onChange={(event) => updateService(index, { imageUrl: event.target.value })}
                    />
                  </Field>
                  <Field label="الترتيب">
                    <input
                      type="number"
                      value={service.order}
                      onChange={(event) => updateService(index, { order: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label="الوصف" wide>
                    <textarea
                      rows={3}
                      value={service.description}
                      onChange={(event) => updateService(index, { description: event.target.value })}
                    />
                  </Field>
                  <Field label="المنصات والعلامات" wide>
                    <textarea
                      rows={2}
                      value={joinLines(service.platforms)}
                      onChange={(event) => updateService(index, { platforms: splitList(event.target.value) })}
                    />
                  </Field>
                </div>
                <RowActions
                  active={service.isActive}
                  onToggle={(isActive) => updateService(index, { isActive })}
                  onDelete={() => removeFromList('services', index)}
                />
              </div>
            ))}
          </EditableList>
        ) : null}

        {activeTab === 'banks' ? (
          <EditableList title="البنوك" onAdd={addBank}>
            {settings.banks.map((bank, index) => (
              <div key={bank.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="grid gap-3 md:grid-cols-5">
                  <Field label="اسم المصرف">
                    <input value={bank.name} onChange={(event) => updateBank(index, { name: event.target.value })} />
                  </Field>
                  <Field label="الشعار">
                    <input dir="ltr" value={bank.logoUrl} onChange={(event) => updateBank(index, { logoUrl: event.target.value })} />
                  </Field>
                  <Field label="لون أول">
                    <input
                      type="color"
                      value={bank.colorFrom}
                      onChange={(event) => updateBank(index, { colorFrom: event.target.value })}
                    />
                  </Field>
                  <Field label="لون ثاني">
                    <input type="color" value={bank.colorTo} onChange={(event) => updateBank(index, { colorTo: event.target.value })} />
                  </Field>
                  <Field label="الترتيب">
                    <input type="number" value={bank.order} onChange={(event) => updateBank(index, { order: Number(event.target.value) })} />
                  </Field>
                </div>
                <RowActions
                  active={bank.isActive}
                  onToggle={(isActive) => updateBank(index, { isActive })}
                  onDelete={() => removeFromList('banks', index)}
                />
              </div>
            ))}
          </EditableList>
        ) : null}

        {activeTab === 'accounts' ? (
          <EditableList title="حسابات التحويل" onAdd={addAccount}>
            {settings.transferAccounts.map((account, index) => (
              <div key={account.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="المصرف">
                    <input value={account.bankName} onChange={(event) => updateAccount(index, { bankName: event.target.value })} />
                  </Field>
                  <Field label="صاحب الحساب">
                    <input value={account.ownerName} onChange={(event) => updateAccount(index, { ownerName: event.target.value })} />
                  </Field>
                  <Field label="رقم الحساب">
                    <input
                      dir="ltr"
                      value={account.accountNumber}
                      onChange={(event) => updateAccount(index, { accountNumber: event.target.value })}
                    />
                  </Field>
                  <Field label="IBAN">
                    <input dir="ltr" value={account.iban} onChange={(event) => updateAccount(index, { iban: event.target.value })} />
                  </Field>
                  <Field label="العملة">
                    <input
                      dir="ltr"
                      value={account.currency}
                      onChange={(event) => updateAccount(index, { currency: event.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="الدولة">
                    <input value={account.country} onChange={(event) => updateAccount(index, { country: event.target.value })} />
                  </Field>
                  <Field label="قيمة QR">
                    <input dir="ltr" value={account.qrValue} onChange={(event) => updateAccount(index, { qrValue: event.target.value })} />
                  </Field>
                  <Field label="رابط مباشر">
                    <input
                      dir="ltr"
                      value={account.directUrl}
                      onChange={(event) => updateAccount(index, { directUrl: event.target.value })}
                    />
                  </Field>
                  <Field label="الترتيب">
                    <input
                      type="number"
                      value={account.order}
                      onChange={(event) => updateAccount(index, { order: Number(event.target.value) })}
                    />
                  </Field>
                </div>
                <RowActions
                  active={account.isActive}
                  onToggle={(isActive) => updateAccount(index, { isActive })}
                  onDelete={() => removeFromList('transferAccounts', index)}
                />
              </div>
            ))}
          </EditableList>
        ) : null}

        {activeTab === 'contact' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="الهاتف">
              <input
                dir="ltr"
                value={settings.contact.phone}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, contact: { ...current.contact, phone: event.target.value } }))
                }
              />
            </Field>
            <Field label="عرض الهاتف">
              <input
                dir="ltr"
                value={settings.contact.phoneDisplay}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, contact: { ...current.contact, phoneDisplay: event.target.value } }))
                }
              />
            </Field>
            <Field label="رقم واتساب">
              <input
                dir="ltr"
                value={settings.contact.whatsappNumber}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, contact: { ...current.contact, whatsappNumber: event.target.value } }))
                }
              />
            </Field>
            <Field label="Facebook URL">
              <input
                dir="ltr"
                value={settings.contact.facebookUrl}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, contact: { ...current.contact, facebookUrl: event.target.value } }))
                }
              />
            </Field>
            <Field label="Google Maps URL">
              <input
                dir="ltr"
                value={settings.contact.mapsUrl}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, contact: { ...current.contact, mapsUrl: event.target.value } }))
                }
              />
            </Field>
            <Field label="العنوان" wide>
              <textarea
                rows={2}
                value={settings.contact.address}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, contact: { ...current.contact, address: event.target.value } }))
                }
              />
            </Field>
          </div>
        ) : null}

        {activeTab === 'identity' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Eyebrow">
              <input
                value={settings.hero.eyebrow}
                onChange={(event) => setSettings((current) => ({ ...current, hero: { ...current.hero, eyebrow: event.target.value } }))}
              />
            </Field>
            <Field label="عنوان Hero">
              <input
                value={settings.hero.title}
                onChange={(event) => setSettings((current) => ({ ...current, hero: { ...current.hero, title: event.target.value } }))}
              />
            </Field>
            <Field label="صورة Hero">
              <input
                dir="ltr"
                value={settings.hero.imageUrl}
                onChange={(event) => setSettings((current) => ({ ...current, hero: { ...current.hero, imageUrl: event.target.value } }))}
              />
            </Field>
            <Field label="وصف Hero" wide>
              <textarea
                rows={3}
                value={settings.hero.description}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, hero: { ...current.hero, description: event.target.value } }))
                }
              />
            </Field>
            <Field label="Quick Trust" wide>
              <textarea
                rows={4}
                value={joinLines(settings.trustSignals)}
                onChange={(event) => setSettings((current) => ({ ...current, trustSignals: splitList(event.target.value) }))}
              />
            </Field>
            <Field label="لماذا الوسيط العالمي" wide>
              <textarea
                rows={4}
                value={joinLines(settings.reasons)}
                onChange={(event) => setSettings((current) => ({ ...current, reasons: splitList(event.target.value) }))}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EditableList({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-black">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
        >
          <Plus size={18} />
          إضافة
        </button>
      </div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'md:col-span-2' : ''}>
      <span className="mb-1.5 block text-xs font-black text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function RowActions({
  active,
  onToggle,
  onDelete,
}: {
  active: boolean;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <label className="inline-flex items-center gap-2 text-sm font-black text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={active} onChange={(event) => onToggle(event.target.checked)} />
        Active
      </label>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-200"
      >
        <Trash2 size={17} />
        حذف
      </button>
    </div>
  );
}
