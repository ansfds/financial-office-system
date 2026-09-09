import { describe, expect, it } from 'vitest';
import { exactCustomerNameMatches } from '@/lib/customer-name-resolution';
import { parseInstantMessage } from '@/lib/instant-registration-parser';

function expectCardEntry(text: string) {
  const parsed = parseInstantMessage(text);
  expect(parsed.kind).toBe('CARD_ENTRY');
  if (parsed.kind !== 'CARD_ENTRY') throw new Error(`Expected CARD_ENTRY, received ${parsed.kind}`);
  return parsed;
}

describe('instant registration parser', () => {
  it('parses a new customer card message with Arabic labels', () => {
    const parsed = parseInstantMessage(`محمد عمرو
0919026616
بطاقة جمهورية
5848
القيمة 2000$
المتفق 1790$
لم يستلم شيء`);

    expect(parsed.kind).toBe('CARD_ENTRY');
    if (parsed.kind !== 'CARD_ENTRY') return;
    expect(parsed.personName).toBe('محمد عمرو');
    expect(parsed.phone).toBe('0919026616');
    expect(parsed.bankName).toBe('بطاقة جمهورية');
    expect(parsed.cards[0].cardLast4).toBe('5848');
    expect(parsed.cards[0].valueAmount?.value).toBe(2000);
    expect(parsed.cards[0].agreedAmount?.value).toBe(1790);
    expect(parsed.cards[0].receivedAmount?.value).toBe(0);
  });

  it('parses multiple cards in one message', () => {
    const parsed = parseInstantMessage(`عبد الحكيم محمد

بطاقتان:

4176 قيمة 2000 المتفق 1800
1288 قيمة 2000 المتفق 1800`);

    expect(parsed.kind).toBe('CARD_ENTRY');
    if (parsed.kind !== 'CARD_ENTRY') return;
    expect(parsed.personName).toBe('عبد الحكيم محمد');
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.cards.map((card) => [card.cardLast4, card.valueAmount?.value, card.agreedAmount?.value])).toEqual([
      ['4176', 2000, 1800],
      ['1288', 2000, 1800],
    ]);
  });

  it('parses the required inline four-card message with customer code, phone, and failed card context', () => {
    const parsed = expectCardEntry(
      'كمال محمد #A039 رقم الهاتف 0914550555 لديه 4 بطاقات، 9888 قيمة 2000$ المتفق 1800$ المستلم 0$، 0145 قيمة 2000$ المتفق 1800$ فشل حمراء، 3221 قيمة 2000$ المتفق 1800$ المستلم 0$، 7193 قيمة 2000$ المتفق 1800$ المستلم 0$.',
    );

    expect(parsed.personName).toBe('كمال محمد');
    expect(parsed.customerCode).toBe('A039');
    expect(parsed.phone).toBe('0914550555');
    expect(parsed.expectedCardCount).toBe(4);
    expect(parsed.cards).toHaveLength(4);
    expect(parsed.cards.map((card) => [card.cardLast4, card.valueAmount?.value, card.agreedAmount?.value, card.receivedAmount?.value])).toEqual([
      ['9888', 2000, 1800, 0],
      ['0145', 2000, 1800, undefined],
      ['3221', 2000, 1800, 0],
      ['7193', 2000, 1800, 0],
    ]);
    expect(parsed.cards[1]).toEqual(expect.objectContaining({ status: 'REJECTED', reason: 'فشل حمراء' }));
    expect(parsed.warnings.some((warning) => warning.includes('تم ذكر 4 بطاقات'))).toBe(false);
  });

  it('parses the required markdown and emoji message as a settled card entry', () => {
    const parsed = expectCardEntry(`📌 **حسين عمار**
📞 0911154117
💳 البطاقة: **4197**
💰 قيمة البطاقة: **2,000$**
🤝 المتفق عليه: **1,810$**
✅ تم استلام كامل المبلغ
💵 المتبقي: **0$**
🟢 **الحالة: صافي بالكامل ✅**`);

    expect(parsed.personName).toBe('حسين عمار');
    expect(parsed.phone).toBe('0911154117');
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]).toEqual(
      expect.objectContaining({
        cardLast4: '4197',
        status: 'SETTLED',
      }),
    );
    expect(parsed.cards[0].valueAmount?.value).toBe(2000);
    expect(parsed.cards[0].agreedAmount?.value).toBe(1810);
    expect(parsed.cards[0].receivedAmount?.value).toBe(1810);
    expect(parsed.cards[0].remainingAmount?.value).toBe(0);
  });

  it('parses multiline card sections without treating aggregate amounts as cards', () => {
    const parsed = parseInstantMessage(`محمد كساب زبون جديد

إجمالي المتفق للبطاقات الجديدة 4583$

المستلم 1000$

المتبقي 3583$

البطاقات المستلمة منه:

9664 فيها 2000$ متفق عليه 1795$

2691 فيها 1703$ متفق عليه 1524$

8287 فيها 1413$ متفق عليه 1264$`);

    expect(parsed.kind).toBe('CARD_ENTRY');
    if (parsed.kind !== 'CARD_ENTRY') return;
    expect(parsed.personName).toBe('محمد كساب');
    expect(parsed.cards).toHaveLength(3);
    expect(parsed.cards.map((card) => card.cardLast4)).toEqual(['9664', '2691', '8287']);
    expect(parsed.cards.map((card) => [card.cardLast4, card.valueAmount?.value, card.agreedAmount?.value])).toEqual([
      ['9664', 2000, 1795],
      ['2691', 1703, 1524],
      ['8287', 1413, 1264],
    ]);
    expect(parsed.cards.map((card) => card.cardLast4)).not.toEqual(expect.arrayContaining(['4583', '1000', '3583']));
    expect(parsed.cards.some((card) => card.receivedAmount?.value === 1000)).toBe(false);
    expect(parsed.totalAgreedAmount?.value).toBe(4583);
    expect(parsed.totalReceivedAmount?.value).toBe(1000);
    expect(parsed.totalRemainingAmount?.value).toBe(3583);
    expect(parsed.deliveryAmount?.value).toBe(1000);
    expect(parsed.totalsVerified).toBe(true);
    expect(parsed.warnings.some((warning) => warning.startsWith('تعارض حسابي'))).toBe(false);
  });

  it('warns when multiline card detail totals disagree with aggregate labels', () => {
    const parsed = parseInstantMessage(`محمد كساب زبون جديد
إجمالي المتفق للبطاقات الجديدة 4584$
المستلم 1000$
المتبقي 3583$
البطاقات المستلمة منه:
9664 فيها 2000$ متفق عليه 1795$
2691 فيها 1703$ متفق عليه 1524$
8287 فيها 1413$ متفق عليه 1264$`);

    expect(parsed.kind).toBe('CARD_ENTRY');
    if (parsed.kind !== 'CARD_ENTRY') return;
    expect(parsed.cards.map((card) => card.cardLast4)).toEqual(['9664', '2691', '8287']);
    expect(parsed.cards.map((card) => card.cardLast4)).not.toEqual(expect.arrayContaining(['4584', '1000', '3583']));
    expect(parsed.totalsVerified).toBe(false);
    expect(parsed.warnings.some((warning) => warning.startsWith('تعارض حسابي'))).toBe(true);
  });

  it('extracts a leading customer name from inline card entry messages', () => {
    const parsed = parseInstantMessage('عبد الحكيم محمد بطاقة جديدة 0123 قيمة 2000$ المتفق 1810$ المستلم 0$');

    expect(parsed.kind).toBe('CARD_ENTRY');
    if (parsed.kind !== 'CARD_ENTRY') return;
    expect(parsed.personName).toBe('عبد الحكيم محمد');
    expect(parsed.cards[0].cardLast4).toBe('0123');
    expect(parsed.cards[0].valueAmount?.value).toBe(2000);
    expect(parsed.cards[0].agreedAmount?.value).toBe(1810);
    expect(parsed.cards[0].receivedAmount?.value).toBe(0);
    expect((parsed.cards[0].agreedAmount?.value || 0) - (parsed.cards[0].receivedAmount?.value || 0)).toBe(1810);
  });

  it.each([
    ['فيها + صافي', 'سالم علي بطاقة 9888 فيها 2000 صافي 1800', 'سالم علي', '9888', 2000, 1800],
    ['قيمة الكرت + $ before number', 'ليلى خالد بطاقة 1234 قيمة الكرت $2000 متفق عليه $1810', 'ليلى خالد', '1234', 2000, 1810],
    ['thousands separators', 'مروان فتحي بطاقة 4321 قيمة البطاقة 2,000$ الحساب عليه 1,795$', 'مروان فتحي', '4321', 2000, 1795],
    ['Arabic digits', 'هدى صالح بطاقة 9876 القيمة ٢٠٠٠$ المتفق ١٨٠٠$ المستلم ٠$', 'هدى صالح', '9876', 2000, 1800],
    ['آخر 4 label', 'يوسف مراد آخر 4: 2468 القيمة 2000 المتفق 1800', 'يوسف مراد', '2468', 2000, 1800],
    ['الكرت فيه', 'جمال سعيد الكرت 1357 فيه 2000 الصافي 1790', 'جمال سعيد', '1357', 2000, 1790],
    ['USD words', 'منى سالم بطاقة 3141 قيمة 2000 USD المتفق 1810 USD', 'منى سالم', '3141', 2000, 1810],
    ['دولار words', 'علي منصور بطاقة 2718 قيمة 2000 دولار المتفق 1800 دولار', 'علي منصور', '2718', 2000, 1800],
    ['dash positional format', '9888 - 2000$ - 1800$', undefined, '9888', 2000, 1800],
    ['single-line unordered settled entry', 'نورا أمين صافي بالكامل بطاقة 4197 المتفق 1810 القيمة 2000 الهاتف 0911111111', 'نورا أمين', '4197', 2000, 1810],
  ])('parses flexible card entry variation: %s', (_label, text, personName, last4, value, agreed) => {
    const parsed = expectCardEntry(text);
    expect(parsed.personName).toBe(personName);
    expect(parsed.cards[0].cardLast4).toBe(last4);
    expect(parsed.cards[0].valueAmount?.value).toBe(value);
    expect(parsed.cards[0].agreedAmount?.value).toBe(agreed);
  });

  it.each([
    ['plain multiline', `حسين عمار
0911154117
البطاقة 4197
القيمة 2000$
المتفق 1810$
تم استلام كامل المبلغ
المتبقي 0$
الحالة صافي بالكامل`],
    ['plain one line', 'حسين عمار 0911154117 بطاقة 4197 قيمة 2000 المتفق 1810 تم استلام كامل المبلغ المتبقي 0 صافي بالكامل'],
    [
      'production requested one line',
      'حسين عمار 0911154117 البطاقة 4197 قيمة البطاقة 2000$ المتفق عليه 1810$ تم استلام كامل المبلغ المتبقي 0$ الحالة صافي بالكامل',
    ],
    ['reordered fields', 'حسين عمار صافي بالكامل بطاقة 4197 المتفق 1810 القيمة 2000 الهاتف 0911154117'],
    ['markdown only', '**حسين عمار**\nالبطاقة: **4197**\nقيمة البطاقة: **2,000$**\nالمتفق عليه: **1,810$**\nتم استلام كامل المبلغ'],
    ['emoji one line', '📌 حسين عمار 📞 0911154117 💳 بطاقة 4197 💰 قيمة 2000 🤝 المتفق 1810 ✅ تم استلام كامل المبلغ 🟢 صافي بالكامل'],
    ['مصفى synonym', 'حسين عمار بطاقة 4197 قيمة 2000 المتفق 1810 مصفى المتبقي 0'],
  ])('keeps settled-card parsing stable across format variation: %s', (_label, text) => {
    const parsed = expectCardEntry(text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.personName).toBe('حسين عمار');
    expect(parsed.cards[0].cardLast4).toBe('4197');
    expect(parsed.cards[0].valueAmount?.value).toBe(2000);
    expect(parsed.cards[0].agreedAmount?.value).toBe(1810);
    expect(parsed.cards[0].status).toBe('SETTLED');
    expect(parsed.cards[0].receivedAmount?.value).toBe(1810);
    expect(parsed.cards[0].remainingAmount?.value).toBe(0);
  });

  it('derives missing received and remaining values from clear arithmetic only', () => {
    const remainingKnown = expectCardEntry('رامي حسن بطاقة 1111 قيمة 2000 المتفق 1800 المتبقي 800');
    const receivedKnown = expectCardEntry('سعد عمر بطاقة 2222 قيمة 2000 المتفق 1800 المستلم 1000');

    expect(remainingKnown.cards[0].receivedAmount?.value).toBe(1000);
    expect(receivedKnown.cards[0].remainingAmount?.value).toBe(800);
  });

  it('warns when a declared card count is larger than detected card segments', () => {
    const parsed = expectCardEntry(
      'فاطمة سالم لديها 4 بطاقات، 1111 قيمة 2000 المتفق 1800، 2222 قيمة 2000 المتفق 1800، 3333 قيمة 2000 المتفق 1800',
    );

    expect(parsed.cards).toHaveLength(3);
    expect(parsed.warnings).toContain('تم ذكر 4 بطاقات لكن تم التعرف على 3 فقط.');
  });

  it('keeps ambiguous unlabeled amounts under review instead of guessing', () => {
    const parsed = expectCardEntry('أحمد علي بطاقة جديدة 5555 1800');

    expect(parsed.cards[0].cardLast4).toBe('5555');
    expect(parsed.cards[0].valueAmount).toBeUndefined();
    expect(parsed.cards[0].agreedAmount).toBeUndefined();
    expect(parsed.warnings.some((warning) => warning.startsWith('رقم مبهم'))).toBe(true);
  });

  it('separates inline aggregate totals from the final card segment', () => {
    const parsed = expectCardEntry(
      'خالد توفيق لديه 3 بطاقات 1111 قيمة 2000 المتفق 1795، 2222 قيمة 1703 المتفق 1524، 3333 قيمة 1413 المتفق 1264، إجمالي المتفق 4583$ المستلم 1000$ المتبقي 3583$',
    );

    expect(parsed.cards.map((card) => [card.cardLast4, card.valueAmount?.value, card.agreedAmount?.value])).toEqual([
      ['1111', 2000, 1795],
      ['2222', 1703, 1524],
      ['3333', 1413, 1264],
    ]);
    expect(parsed.cards[2].receivedAmount).toBeUndefined();
    expect(parsed.totalAgreedAmount?.value).toBe(4583);
    expect(parsed.totalReceivedAmount?.value).toBe(1000);
    expect(parsed.totalRemainingAmount?.value).toBe(3583);
    expect(parsed.totalsVerified).toBe(true);
  });

  it('does not classify aggregate-only four-digit amounts as card entries', () => {
    const parsed = parseInstantMessage('إجمالي المتفق 4583$ المستلم 1000$ المتبقي 3583$');

    expect(parsed.kind).toBe('UNKNOWN');
  });

  it('captures stopped and rejected card reasons inside card-entry rows', () => {
    const rejected = expectCardEntry('بطاقة 3333 قيمة 2000 المتفق 1800 فشل حمراء');
    const stopped = expectCardEntry('بطاقة 4444 قيمة 2000 المتفق 1800 متوقفة السبب رصيد غير كاف');

    expect(rejected.cards[0].status).toBe('REJECTED');
    expect(rejected.cards[0].reason).toBe('فشل حمراء');
    expect(rejected.cards[0].receivedAmount).toBeUndefined();
    expect(stopped.cards[0].status).toBe('STOPPED');
    expect(stopped.cards[0].reason).toBe('رصيد غير كاف');
  });

  it('extracts a leading customer name from delivery, withdrawal, and settlement messages', () => {
    const delivery = parseInstantMessage('عبد الحكيم محمد استلم 500$');
    const withdrawal = parseInstantMessage('عبد الحكيم محمد بطاقة 0123 سحب 476$');
    const settlement = parseInstantMessage('عبد الحكيم محمد 0123 صافي بالكامل');

    expect(delivery.kind).toBe('CUSTOMER_DELIVERY');
    if (delivery.kind === 'CUSTOMER_DELIVERY') {
      expect(delivery.personName).toBe('عبد الحكيم محمد');
      expect(delivery.amount?.value).toBe(500);
    }

    expect(withdrawal.kind).toBe('CARD_WITHDRAWAL');
    if (withdrawal.kind === 'CARD_WITHDRAWAL') {
      expect(withdrawal.personName).toBe('عبد الحكيم محمد');
      expect(withdrawal.cardLast4).toBe('0123');
      expect(withdrawal.amount?.value).toBe(476);
    }

    expect(settlement.kind).toBe('CARD_FINAL_SETTLEMENT');
    if (settlement.kind === 'CARD_FINAL_SETTLEMENT') {
      expect(settlement.personName).toBe('عبد الحكيم محمد');
      expect(settlement.cardLast4).toBe('0123');
    }
  });

  it('matches existing customers with flexible Arabic full-name normalization', () => {
    const people = [
      { id: 'p1', fullName: 'عبد   الحكيم محمّد' },
      { id: 'p2', fullName: 'أحمد علي' },
      { id: 'p3', fullName: 'هبة سالم' },
    ];

    expect(exactCustomerNameMatches('عبد الحكيم محمد', people).map((person) => person.id)).toEqual(['p1']);
    expect(exactCustomerNameMatches('احمد علي', people).map((person) => person.id)).toEqual(['p2']);
    expect(exactCustomerNameMatches('هبه سالم', people, { foldTaMarbuta: true }).map((person) => person.id)).toEqual(['p3']);
  });

  it('parses a customer delivery update', () => {
    const parsed = parseInstantMessage('محمد عمرو استلم 500$');

    expect(parsed.kind).toBe('CUSTOMER_DELIVERY');
    if (parsed.kind !== 'CUSTOMER_DELIVERY') return;
    expect(parsed.personName).toBe('محمد عمرو');
    expect(parsed.amount?.value).toBe(500);
    expect(parsed.amount?.currencyCode).toBe('USD');
  });

  it('parses one and multiple card withdrawals', () => {
    const single = parseInstantMessage('بطاقة 5848 تم سحب 476$');
    const multiple = parseInstantMessage('بطاقة 5848 تم تنفيذ 3 سحبات 476$');

    expect(single.kind).toBe('CARD_WITHDRAWAL');
    if (single.kind === 'CARD_WITHDRAWAL') {
      expect(single.cardLast4).toBe('5848');
      expect(single.quantity).toBe(1);
      expect(single.totalAmount?.value).toBe(476);
    }

    expect(multiple.kind).toBe('CARD_WITHDRAWAL');
    if (multiple.kind === 'CARD_WITHDRAWAL') {
      expect(multiple.cardLast4).toBe('5848');
      expect(multiple.quantity).toBe(3);
      expect(multiple.amount?.value).toBe(476);
      expect(multiple.totalAmount?.value).toBe(1428);
    }
  });

  it('parses card settlement and stopped status messages', () => {
    const settlement = parseInstantMessage('5848 صافي بالكامل');
    const stopped = parseInstantMessage('5848 متوقفة — السبب رصيد غير كاف');

    expect(settlement.kind).toBe('CARD_FINAL_SETTLEMENT');
    if (settlement.kind === 'CARD_FINAL_SETTLEMENT') expect(settlement.cardLast4).toBe('5848');

    expect(stopped.kind).toBe('CARD_STATUS');
    if (stopped.kind === 'CARD_STATUS') {
      expect(stopped.cardLast4).toBe('5848');
      expect(stopped.status).toBe('STOPPED');
      expect(stopped.reason).toBe('رصيد غير كاف');
    }
  });

  it('parses لنا وعلينا and repayments', () => {
    const payable = parseInstantMessage('علينا لصهيب 50$');
    const receivable = parseInstantMessage('لنا على محمد 500$');
    const repayment = parseInstantMessage('تم تسديد 152$ لظريف');

    expect(payable.kind).toBe('WALLET_MOVEMENT');
    if (payable.kind === 'WALLET_MOVEMENT') {
      expect(payable.side).toBe('THEM');
      expect(payable.personName).toBe('صهيب');
      expect(payable.amount?.value).toBe(50);
    }

    expect(receivable.kind).toBe('WALLET_MOVEMENT');
    if (receivable.kind === 'WALLET_MOVEMENT') {
      expect(receivable.side).toBe('US');
      expect(receivable.personName).toBe('محمد');
      expect(receivable.amount?.value).toBe(500);
    }

    expect(repayment.kind).toBe('WALLET_REPAYMENT');
    if (repayment.kind === 'WALLET_REPAYMENT') {
      expect(repayment.personName).toBe('ظريف');
      expect(repayment.amount?.value).toBe(152);
    }
  });

  it('normalizes Arabic digits and LYD currency', () => {
    const parsed = parseInstantMessage('لنا على محمد ١٢٣ د.ل');

    expect(parsed.kind).toBe('WALLET_MOVEMENT');
    if (parsed.kind !== 'WALLET_MOVEMENT') return;
    expect(parsed.amount?.value).toBe(123);
    expect(parsed.amount?.currencyCode).toBe('LYD');
  });
});
