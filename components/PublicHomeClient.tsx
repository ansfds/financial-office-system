'use client';

/* eslint-disable @next/next/no-img-element -- Public images are admin-configurable local or remote URLs. */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowUpLeft,
  Banknote,
  Building2,
  Copy,
  CreditCard,
  ExternalLink,
  Gauge,
  Globe2,
  Landmark,
  LockKeyhole,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Plane,
  QrCode,
  ReceiptText,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type {
  PublicBank,
  PublicMarketRate,
  PublicService,
  PublicSiteSettings,
  PublicTransferAccount,
} from '@/lib/public-site-data';

const navItems = [
  { href: '#market', label: 'تحديثات السوق' },
  { href: '#services', label: 'خدماتنا' },
  { href: '#accounts', label: 'حسابات التحويل' },
  { href: '#location', label: 'الموقع' },
  { href: '#contact', label: 'تواصل معنا' },
];

const serviceIcons: Record<string, LucideIcon> = {
  usdt: Wallet,
  'shein-cards': ShoppingBag,
  'global-invoices': ReceiptText,
  'china-payments': Globe2,
  'facebook-wallets': Gauge,
  remittances: Send,
  travel: Plane,
};

function activeByOrder<T extends { isActive: boolean; order: number }>(items: T[]) {
  return items.filter((item) => item.isActive).sort((a, b) => a.order - b.order);
}

function formatMarketDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';

  return new Intl.DateTimeFormat('ar-LY', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function relativeMarketDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'آخر تحديث للأسعار';

  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'تم التحديث الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;

  return formatMarketDate(value);
}

function getQrUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(value)}`;
}

function getWhatsAppUrl(number: string, message?: string) {
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${number.replace(/[^\d]/g, '')}${text}`;
}

function getMapEmbedUrl(address: string) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
}

export default function PublicHomeClient({ settings }: { settings: PublicSiteSettings }) {
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const services = useMemo(() => activeByOrder(settings.services), [settings.services]);
  const rates = useMemo(() => activeByOrder(settings.marketRates), [settings.marketRates]);
  const banks = useMemo(() => activeByOrder(settings.banks), [settings.banks]);
  const accounts = useMemo(() => activeByOrder(settings.transferAccounts), [settings.transferAccounts]);
  const chinaService = services.find((service) => service.id === 'china-payments') || services[0];
  const latestMarketUpdate = rates.reduce((latest, rate) => {
    const rateTime = new Date(rate.updatedAt).getTime();
    const latestTime = new Date(latest).getTime();
    return Number.isFinite(rateTime) && rateTime > latestTime ? rate.updatedAt : latest;
  }, rates[0]?.updatedAt || new Date().toISOString());

  useEffect(() => {
    document.body.classList.add('public-page');
    return () => document.body.classList.remove('public-page');
  }, []);

  useEffect(() => {
    function updateScrolled() {
      setScrolled(window.scrollY > 18);
    }

    updateScrolled();
    window.addEventListener('scroll', updateScrolled, { passive: true });
    return () => window.removeEventListener('scroll', updateScrolled);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error('تعذر النسخ، جرّب مرة أخرى');
    }
  }

  const reveal: HTMLMotionProps<'section'> = reduceMotion
    ? { initial: false }
    : {
        initial: { opacity: 0, y: 34, filter: 'blur(10px)' },
        whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
        viewport: { once: true, amount: 0.2 },
        transition: { duration: 0.65, ease: 'easeOut' as const },
      };

  return (
    <div className="public-site min-h-screen overflow-hidden bg-[#031124] text-white">
      <header
        className={`public-nav fixed inset-x-0 top-0 z-50 transition duration-300 ${
          scrolled ? 'public-nav--solid' : 'public-nav--glass'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#" className="flex min-w-0 items-center gap-3" aria-label="الوسيط العالمي">
            <img
              src="/brand/elwaseet-logo-reference.jpg"
              alt="شعار الوسيط العالمي"
              className="h-14 w-14 flex-shrink-0 rounded-md object-cover shadow-[0_0_28px_rgba(56,189,248,0.25)] md:h-16 md:w-16"
            />
            <span className="min-w-0">
              <span className="block text-base font-black leading-6 md:text-xl">الوسيط العالمي</span>
              <span className="block truncate text-xs font-bold text-sky-100/80 md:text-sm">ELWASEET ELALAMY</span>
            </span>
          </a>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="public-nav-link">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <a href="/dashboard" className="public-secondary-button">
              <LockKeyhole size={18} />
              الإدارة
            </a>
            <a
              href={getWhatsAppUrl(settings.contact.whatsappNumber, 'مرحبًا، أريد الاستفسار عن خدمات الوسيط العالمي')}
              target="_blank"
              rel="noreferrer"
              className="public-primary-button"
            >
              <MessageCircle size={19} />
              واتساب
            </a>
          </div>

          <button
            type="button"
            aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={menuOpen}
            className="public-icon-button lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        <div className={`public-mobile-menu lg:hidden ${menuOpen ? 'public-mobile-menu--open' : ''}`}>
          <nav className="grid gap-1 px-4 pb-4">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="public-mobile-link" onClick={() => setMenuOpen(false)}>
                {item.label}
              </a>
            ))}
            <a
              href={getWhatsAppUrl(settings.contact.whatsappNumber, 'مرحبًا، أريد التواصل مع الوسيط العالمي')}
              target="_blank"
              rel="noreferrer"
              className="public-mobile-link"
              onClick={() => setMenuOpen(false)}
            >
              واتساب مباشر
            </a>
            <a href="/dashboard" className="public-mobile-link" onClick={() => setMenuOpen(false)}>
              لوحة الإدارة
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="public-hero relative flex min-h-[86svh] items-center overflow-hidden pt-24">
          <img src={settings.hero.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,17,36,0.08),rgba(3,17,36,0.72)_48%,rgba(3,17,36,0.96)_82%)] md:bg-[linear-gradient(90deg,rgba(3,17,36,0.08),rgba(3,17,36,0.68)_52%,rgba(3,17,36,0.96)_86%)]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent,#031124)]" />

          <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 pb-10 pt-10 sm:px-6 lg:px-8">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 28 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.72, ease: 'easeOut' }}
              className="max-w-3xl"
            >
              <div className="mb-5 inline-flex items-center gap-2 border-y border-sky-300/30 py-2 text-sm font-bold text-sky-100">
                <Sparkles size={17} />
                {settings.hero.eyebrow}
              </div>
              <h1 className="public-hero-title text-4xl font-black leading-[1.12] text-white sm:text-5xl lg:text-7xl">
                {settings.hero.title}
              </h1>
              <p className="mt-5 max-w-2xl text-base font-semibold leading-8 text-slate-200 sm:text-lg lg:text-xl">
                {settings.hero.description}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a href="#services" className="public-primary-button public-hero-button">
                  <Zap size={20} />
                  خدماتنا
                </a>
                <a href="#market" className="public-secondary-button public-hero-button">
                  <TrendingUp size={20} />
                  تحديثات السوق
                </a>
                <a href="#accounts" className="public-secondary-button public-hero-button">
                  <Landmark size={20} />
                  حسابات التحويل
                </a>
                <a href="#contact" className="public-secondary-button public-hero-button">
                  <MessageCircle size={20} />
                  تواصل معنا
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="relative z-10 mx-auto -mt-8 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="public-trust-strip">
            {settings.trustSignals.map((signal, index) => (
              <motion.div
                key={signal}
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.06, duration: 0.38 }}
                className="flex min-h-[4.5rem] items-center gap-3"
              >
                <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-md bg-sky-400/12 text-sky-200">
                  {index % 2 ? <Gauge size={20} /> : <ShieldCheck size={20} />}
                </span>
                <span className="text-sm font-black leading-6 text-white">{signal}</span>
              </motion.div>
            ))}
          </div>
        </section>

        <motion.section id="market" className="public-section public-market-section" {...reveal}>
          <SectionHeading
            eyebrow="Market Board"
            title="تحديثات السوق"
            description="لوحة أسعار مباشرة قابلة للتعديل من الإدارة، تعرض الأسعار النشطة ووقت آخر تحديث بدون افتراضات وهمية."
          />
          <div className="public-market-board">
            <div className="public-market-board__top">
              <div>
                <span className="text-sm font-black text-sky-200">آخر تحديث للأسعار</span>
                <strong className="mt-1 block text-xl font-black text-white">{relativeMarketDate(latestMarketUpdate)}</strong>
              </div>
              <div className="hidden items-center gap-2 text-sm font-bold text-emerald-200 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.9)]" />
                أسعار نشطة
              </div>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-5">
              {rates.map((rate, index) => (
                <MarketRateCard key={rate.id} rate={rate} index={index} reduceMotion={Boolean(reduceMotion)} />
              ))}
            </div>
          </div>
        </motion.section>

        <section id="services" className="public-section">
          <SectionHeading
            eyebrow="Services"
            title="خدماتنا"
            description="خدمات مالية ورقمية مصممة لتقليل التعقيد في الدفع والتحويل والشراء من المنصات العالمية."
          />

          <div className="mt-10 grid gap-5 lg:gap-8">
            {services.map((service, index) => (
              <ServiceFeature
                key={service.id}
                service={service}
                index={index}
                reduceMotion={Boolean(reduceMotion)}
              />
            ))}
          </div>
        </section>

        {chinaService ? (
          <motion.section className="public-section public-china-feature" {...reveal}>
            <div className="public-feature-grid">
              <div className="public-image-panel">
                <img src={chinaService.imageUrl} alt={chinaService.title} loading="lazy" />
              </div>
              <div className="public-feature-copy">
                <span className="public-eyebrow">China Payments</span>
                <h2>دفع جميع فواتير الصين</h2>
                <p>{chinaService.description}</p>
                <div className="public-platform-grid">
                  {chinaService.platforms.map((platform) => (
                    <span key={platform}>{platform}</span>
                  ))}
                </div>
                <div className="public-warning-line">
                  <X size={20} />
                  دفع فواتير الصين فقط، لا توجد خدمة شحن
                </div>
              </div>
            </div>
          </motion.section>
        ) : null}

        <motion.section id="banks" className="public-section" {...reveal}>
          <SectionHeading
            eyebrow="Bank Cards"
            title="سحب البطاقات المصرفية"
            description="تعاملات منظمة مع بطاقات المصارف الليبية المتاحة، مع إمكانية إضافة بنوك أخرى من لوحة الإدارة."
          />
          <div className="public-bank-stage">
            {banks.map((bank, index) => (
              <BankCard key={bank.id} bank={bank} index={index} />
            ))}
          </div>
        </motion.section>

        <motion.section id="accounts" className="public-section public-accounts-section" {...reveal}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Transfer Accounts"
              title="حسابات التحويل"
              description="بيانات حساب واضحة، QR، وأزرار نسخ مريحة على الهاتف لتقليل أخطاء التحويل."
              compact
            />
            <a href="#contact" className="public-secondary-button w-full justify-center sm:w-auto">
              <ExternalLink size={18} />
              عرض جميع الحسابات
            </a>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {accounts.map((account) => (
              <TransferAccountCard key={account.id} account={account} onCopy={copyValue} />
            ))}
          </div>
        </motion.section>

        <motion.section className="public-section public-reasons-section" {...reveal}>
          <SectionHeading
            eyebrow="Why Elwaseet"
            title="لماذا الوسيط العالمي"
            description="تجربة دفع وتحويل مبنية على الوضوح والسرعة والمتابعة المباشرة."
          />
          <div className="public-reasons-grid">
            {settings.reasons.map((reason, index) => (
              <div key={reason} className="public-reason">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{reason}</strong>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section id="location" className="public-section public-location-section" {...reveal}>
          <div className="public-location-grid">
            <div>
              <span className="public-eyebrow">Location</span>
              <h2>موقعنا</h2>
              <p>{settings.contact.address}</p>
              <a href={settings.contact.mapsUrl} target="_blank" rel="noreferrer" className="public-primary-button mt-6 w-full justify-center sm:w-auto">
                <MapPin size={20} />
                فتح في Google Maps
              </a>
            </div>
            <div className="public-map-shell">
              <iframe
                title="موقع الوسيط العالمي على الخريطة"
                src={getMapEmbedUrl(settings.contact.address)}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </motion.section>

        <motion.section id="contact" className="public-section public-contact-section" {...reveal}>
          <div className="public-contact-panel">
            <div>
              <span className="public-eyebrow">Contact</span>
              <h2>تواصل معنا</h2>
              <p>فريق الوسيط العالمي جاهز لمتابعة طلبك عبر واتساب أو الهاتف أو صفحة Facebook الرسمية.</p>
            </div>
            <div className="public-contact-actions">
              <a
                href={getWhatsAppUrl(settings.contact.whatsappNumber, 'مرحبًا، أريد التواصل مع الوسيط العالمي')}
                target="_blank"
                rel="noreferrer"
                className="public-primary-button"
              >
                <MessageCircle size={22} />
                تواصل عبر واتساب
              </a>
              <a href={settings.contact.facebookUrl} target="_blank" rel="noreferrer" className="public-secondary-button">
                <span className="public-brand-icon">f</span>
                Facebook
              </a>
              <a href={`tel:${settings.contact.phone.replace(/\s/g, '')}`} className="public-secondary-button">
                <Phone size={19} />
                {settings.contact.phoneDisplay}
              </a>
            </div>
          </div>
        </motion.section>
      </main>

      <footer className="public-footer">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.3fr_1fr_1fr] lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <img src="/brand/elwaseet-logo-reference.jpg" alt="شعار الوسيط العالمي" className="h-16 w-16 rounded-md object-cover" />
              <div>
                <strong className="block text-xl font-black">ELWASEET ELALAMY</strong>
                <span className="text-sm font-bold text-sky-100/75">للدفع الإلكتروني والحوالات</span>
              </div>
            </div>
            <p className="mt-5 max-w-md text-sm font-semibold leading-7 text-slate-300">{settings.hero.description}</p>
          </div>

          <div>
            <h3 className="text-sm font-black text-white">روابط</h3>
            <div className="mt-4 grid gap-2 text-sm font-bold text-slate-300">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} className="hover:text-white">
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-black text-white">التواصل</h3>
            <div className="mt-4 grid gap-2 text-sm font-bold text-slate-300">
              <a href={getWhatsAppUrl(settings.contact.whatsappNumber)} target="_blank" rel="noreferrer" className="hover:text-white">
                WhatsApp · {settings.contact.phoneDisplay}
              </a>
              <a href={settings.contact.facebookUrl} target="_blank" rel="noreferrer" className="hover:text-white">
                Facebook
              </a>
              <a href={settings.contact.mapsUrl} target="_blank" rel="noreferrer" className="hover:text-white">
                {settings.contact.address}
              </a>
            </div>
          </div>
        </div>
      </footer>

      <a
        href={getWhatsAppUrl(settings.contact.whatsappNumber, 'مرحبًا، أريد الاستفسار عن خدمات الوسيط العالمي')}
        target="_blank"
        rel="noreferrer"
        className="public-floating-whatsapp"
        aria-label="تواصل عبر واتساب"
      >
        <MessageCircle size={23} />
      </a>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'max-w-3xl' : 'mx-auto max-w-3xl text-center'}>
      <span className="public-eyebrow">{eyebrow}</span>
      <h2 className="mt-3 text-3xl font-black leading-tight text-white md:text-5xl">{title}</h2>
      <p className="mt-4 text-sm font-semibold leading-7 text-slate-300 md:text-base">{description}</p>
    </div>
  );
}

function MarketRateCard({
  rate,
  index,
  reduceMotion,
}: {
  rate: PublicMarketRate;
  index: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ delay: index * 0.05, duration: 0.42 }}
      className="public-market-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-white">{rate.currencyName}</div>
          <div className="mt-1 text-xs font-bold text-sky-200">{rate.currencyCode} · {rate.priceType}</div>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-md bg-sky-300/10 text-sky-200">
          <Banknote size={19} />
        </span>
      </div>
      <div className="num mt-5 flex items-end gap-2 text-left" dir="ltr">
        <strong className="public-market-value">{rate.value}</strong>
        {rate.unit ? <span className="pb-2 text-sm font-black text-slate-300">{rate.unit}</span> : null}
      </div>
      <div className="mt-4 text-xs font-bold text-slate-400">{formatMarketDate(rate.updatedAt)}</div>
    </motion.div>
  );
}

function ServiceFeature({
  service,
  index,
  reduceMotion,
}: {
  service: PublicService;
  index: number;
  reduceMotion: boolean;
}) {
  const Icon = serviceIcons[service.id] || Sparkles;
  const reversed = index % 2 === 1;

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 42, filter: 'blur(12px)' }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.24 }}
      transition={{ duration: 0.62, delay: index * 0.035, ease: 'easeOut' }}
      className={`public-service-feature ${reversed ? 'lg:[direction:ltr]' : ''}`}
    >
      <div className="public-service-image">
        <img src={service.imageUrl} alt={service.title} loading="lazy" />
      </div>
      <div className="public-service-copy lg:[direction:rtl]">
        <span className="grid h-12 w-12 place-items-center rounded-md bg-sky-300/12 text-sky-100">
          <Icon size={23} />
        </span>
        <h3>{service.title}</h3>
        <p>{service.description}</p>
        <div className="flex flex-wrap gap-2">
          {service.platforms.map((platform) => (
            <span key={platform} className="public-chip">
              {platform}
            </span>
          ))}
        </div>
        {service.link ? (
          <a href={service.link} className="public-inline-link">
            اطلب الخدمة
            <ArrowUpLeft size={17} />
          </a>
        ) : null}
      </div>
    </motion.article>
  );
}

function BankCard({ bank, index }: { bank: PublicBank; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28, rotateX: 12 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ delay: index * 0.06, duration: 0.48 }}
      className="public-bank-card"
      style={{ '--card-from': bank.colorFrom, '--card-to': bank.colorTo } as CSSProperties}
    >
      <div className="public-bank-card__shine" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black text-white/70">ELWASEET CARD SERVICE</span>
          <strong className="mt-3 block text-xl font-black text-white">{bank.name}</strong>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-md bg-white/14 text-white">
          {bank.logoUrl ? <img src={bank.logoUrl} alt="" className="h-8 w-8 object-contain" loading="lazy" /> : <CreditCard size={24} />}
        </span>
      </div>
      <div className="mt-10 flex items-center justify-between gap-3">
        <span className="h-8 w-11 rounded-md bg-white/18 shadow-inner" />
        <span className="text-xs font-black text-white/80">ACTIVE</span>
      </div>
    </motion.div>
  );
}

function TransferAccountCard({
  account,
  onCopy,
}: {
  account: PublicTransferAccount;
  onCopy: (value: string, label: string) => void;
}) {
  const qrValue = account.qrValue || account.iban || account.accountNumber;

  return (
    <div className="public-account-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="public-eyebrow">Bank Account</span>
          <h3>{account.bankName}</h3>
          <p>{account.ownerName}</p>
        </div>
        <span className="inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-300/20 px-3 text-sm font-black text-sky-100">
          <Building2 size={18} />
          {account.country} · {account.currency}
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3">
          <AccountLine label="IBAN / رقم الحساب" value={account.iban || account.accountNumber} />
          {account.accountNumber !== account.iban ? <AccountLine label="رقم الحساب" value={account.accountNumber} /> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="public-copy-button"
              onClick={() => onCopy(account.accountNumber, 'تم نسخ رقم الحساب بنجاح')}
            >
              <Copy size={18} />
              نسخ الرقم
            </button>
            <button type="button" className="public-copy-button" onClick={() => onCopy(account.iban, 'تم نسخ IBAN بنجاح')}>
              <QrCode size={18} />
              نسخ IBAN
            </button>
          </div>
          {account.directUrl ? (
            <a href={account.directUrl} target="_blank" rel="noreferrer" className="public-inline-link">
              رابط مباشر
              <ExternalLink size={17} />
            </a>
          ) : null}
        </div>
        <div className="public-qr-box">
          <img src={getQrUrl(qrValue)} alt="QR حساب التحويل" loading="lazy" />
        </div>
      </div>
    </div>
  );
}

function AccountLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="public-account-line">
      <span>{label}</span>
      <strong className="num" dir="ltr">
        {value}
      </strong>
    </div>
  );
}
