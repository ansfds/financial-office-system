import { describe, expect, it } from 'vitest';
import {
  enforceArabicAssistantMessage,
  formatCardReadAnswer,
  formatCustomerReadAnswer,
  formatDuplicateCustomers,
  formatSystemAccountAnswer,
  isRawAssistantData,
  tryBuildDeterministicReadIntent,
  type AssistantCustomerReadView,
} from '@/lib/smart-assistant/read-format';

const baseView: AssistantCustomerReadView = {
  customer: { code: '#M0001', name: 'عبد الرزاق' },
  cards: [
    {
      publicCode: '#C0001',
      cardLast4: '9953',
      bankName: 'مصرف الوحدة',
      originalAmount: 2000,
      agreedAmount: 1976,
      agreedCurrencyCode: 'USD',
      agreedCurrencySymbol: '$',
      deductedAmount: 101,
      remainingAmount: 1899,
      status: 'IN_SETTLEMENT',
      lastOperation: {
        label: 'كروت',
        amount: 101,
        currencyCode: 'USD',
        currencySymbol: '$',
        occurredAt: '2026-08-16T10:30:00.000Z',
      },
    },
    {
      publicCode: '#C0002',
      cardLast4: '7711',
      bankName: null,
      originalAmount: 2400,
      agreedAmount: 1976,
      agreedCurrencyCode: 'USD',
      agreedCurrencySymbol: '$',
      deductedAmount: 0,
      remainingAmount: 2400,
      status: 'RECEIVED',
      lastOperation: null,
    },
  ],
  totalOriginalUsd: 4400,
  agreedByCurrency: [{ amount: 3952, currencyCode: 'USD', currencySymbol: '$' }],
  deliveredByCurrency: [{ amount: 1200, currencyCode: 'USD', currencySymbol: '$' }],
  financialRemainingByCurrency: [{ amount: 2752, currencyCode: 'USD', currencySymbol: '$' }],
  walletDebtByCurrency: [{ amount: 4430, currencyCode: 'USD', currencySymbol: '$' }],
  walletCreditByCurrency: [],
  hasDeliveries: true,
  latestActivity: { label: 'حركة لنا وعلينا', occurredAt: '2026-08-16T11:00:00.000Z' },
};

function expectHumanArabic(message: string) {
  expect(message).not.toMatch(/[{}]/);
  expect(message).not.toContain('```');
  expect(message).not.toMatch(/"[^"]+"\s*:/);
  expect(message).not.toMatch(/customerCode|currencyCode|function_call|JSON/i);
}

describe('smart assistant Arabic read formatting', () => {
  it('answers "كم دين عبد الرزاق؟" with current unpaid debt only', () => {
    const intent = tryBuildDeterministicReadIntent('كم دين عبد الرزاق؟');
    expect(intent?.queryMode).toBe('DEBT_SUMMARY');
    expect(intent?.customerName).toBe('عبد الرزاق');

    const message = formatCustomerReadAnswer('DEBT_SUMMARY', baseView);
    expect(message).toContain('الدين الحالي: 4,430$');
    expect(message).toContain('الحالة: لم يتم السداد.');
    expectHumanArabic(message);
  });

  it('answers "كم استلم عبد المعين؟" with delivered and remaining amounts', () => {
    const intent = tryBuildDeterministicReadIntent('كم استلم عبد المعين؟');
    expect(intent?.queryMode).toBe('DELIVERIES_SUMMARY');
    expect(intent?.customerName).toBe('عبد المعين');

    const message = formatCustomerReadAnswer('DELIVERIES_SUMMARY', {
      ...baseView,
      customer: { code: '#M0003', name: 'عبد المعين' },
    });
    expect(message).toContain('إجمالي المسلّم: 1,200$');
    expect(message).toContain('المتبقي للزبون: 2,752$');
    expectHumanArabic(message);
  });

  it('answers "ما بطاقات مراد؟" as a card summary, not full customer data', () => {
    const intent = tryBuildDeterministicReadIntent('ما بطاقات مراد؟');
    expect(intent?.queryMode).toBe('CARDS_SUMMARY');
    expect(intent?.customerName).toBe('مراد');

    const message = formatCustomerReadAnswer('CARDS_SUMMARY', {
      ...baseView,
      customer: { code: '#A020', name: 'مراد' },
    });
    expect(message).toContain('عدد البطاقات: 2');
    expect(message).toContain('إجمالي المبلغ الأصلي: 4,400$');
    expect(message).not.toContain('لنا:');
    expectHumanArabic(message);
  });

  it('answers "ما المتبقي داخل البطاقة 9953؟" from card balance only', () => {
    const intent = tryBuildDeterministicReadIntent('ما المتبقي داخل البطاقة 9953؟');
    expect(intent?.queryMode).toBe('CARD_REMAINING');
    expect(intent?.cardLast4).toBe('9953');

    const message = formatCardReadAnswer('CARD_REMAINING', baseView.cards[0], baseView.customer);
    expect(message).toContain('المتبقي داخل البطاقة: 1,899$');
    expect(message).toContain('المسحوب: 101$');
    expectHumanArabic(message);
  });

  it('answers "ما المتبقي المالي للزبون؟" without mixing it with card remaining', () => {
    const intent = tryBuildDeterministicReadIntent('ما المتبقي المالي للزبون؟');
    expect(intent?.queryMode).toBe('FINANCIAL_REMAINING');
    expect(intent?.customerName).toBeUndefined();

    const message = formatCustomerReadAnswer('FINANCIAL_REMAINING', baseView);
    expect(message).toContain('المتبقي المالي للزبون: 2,752$');
    expect(message).not.toContain('المتبقي داخل البطاقة');
    expectHumanArabic(message);
  });

  it('answers "اعرض حساب ظريف." with a concise account summary', () => {
    const intent = tryBuildDeterministicReadIntent('اعرض حساب ظريف.');
    expect(intent?.queryMode).toBe('ACCOUNT_SUMMARY');
    expect(intent?.customerName).toBe('ظريف');

    const message = formatCustomerReadAnswer('ACCOUNT_SUMMARY', {
      ...baseView,
      customer: { code: '#Z010', name: 'ظريف' },
    });
    expect(message).toContain('لنا: 4,430$');
    expect(message).toContain('علينا: لا يوجد');
    expectHumanArabic(message);
  });

  it('shows codes when a name is duplicated', () => {
    const message = formatDuplicateCustomers([
      { code: '#M0001', name: 'محمد علي' },
      { code: '#M0044', name: 'محمد علي' },
    ]);
    expect(message).toContain('#M0001 - محمد علي');
    expect(message).toContain('#M0044 - محمد علي');
    expectHumanArabic(message);
  });

  it('keeps two currencies separated in لنا وعلينا', () => {
    const message = formatSystemAccountAnswer({
      walletDebtByCurrency: [
        { amount: 4430, currencyCode: 'USD', currencySymbol: '$' },
        { amount: 900, currencyCode: 'LYD', currencySymbol: 'د.ل' },
      ],
      walletCreditByCurrency: [{ amount: 250, currencyCode: 'USDT', currencySymbol: 'USDT' }],
      latestActivity: null,
    });
    expect(message).toContain('4,430$');
    expect(message).toContain('900 د.ل');
    expect(message).toContain('250 USDT');
    expect(message).not.toContain('5,330');
    expectHumanArabic(message);
  });

  it('answers clearly when a customer has no deliveries', () => {
    const message = formatCustomerReadAnswer('DELIVERIES_SUMMARY', {
      ...baseView,
      deliveredByCurrency: [{ amount: 0, currencyCode: 'USD', currencySymbol: '$' }],
      financialRemainingByCurrency: [{ amount: 3952, currencyCode: 'USD', currencySymbol: '$' }],
      hasDeliveries: false,
    });
    expect(message).toContain('لا توجد حركة مسجلة بهذا النوع.');
    expect(message).toContain('إجمالي المسلّم: 0$');
    expectHumanArabic(message);
  });

  it('formats آخر عملية على البطاقة 9953 with date and amount', () => {
    const intent = tryBuildDeterministicReadIntent('ما آخر عملية على البطاقة 9953؟');
    expect(intent?.queryMode).toBe('CARD_LAST_OPERATION');
    expect(intent?.cardLast4).toBe('9953');

    const message = formatCardReadAnswer('CARD_LAST_OPERATION', baseView.cards[0], baseView.customer);
    expect(message).toContain('آخر حركة: كروت');
    expect(message).toContain('المبلغ: 101$');
    expect(message).toContain('التاريخ:');
    expectHumanArabic(message);
  });

  it('blocks raw JSON-like fallback messages', () => {
    const raw = '{"customerCode":"#M0001","amount":4430}';
    expect(isRawAssistantData(raw)).toBe(true);
    expect(enforceArabicAssistantMessage(raw)).toBe('لم أستطع تجهيز إجابة عربية واضحة. أعد صياغة السؤال باختصار.');
  });
});
