import { describe, expect, it } from 'vitest';
import { exactCustomerNameMatches } from '@/lib/customer-name-resolution';
import { parseInstantMessage } from '@/lib/instant-registration-parser';

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
