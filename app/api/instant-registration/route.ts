import { requireSession } from '@/lib/auth';
import {
  buildInstantRegistrationPreview,
  executeInstantRegistration,
  instantRegistrationHistory,
} from '@/lib/instant-registration';
import { apiError, fail, ok } from '@/lib/http';
import { z } from 'zod';

const requestSchema = z.object({
  text: z.string().trim().min(1),
  confirm: z.boolean().optional().default(false),
  personId: z.string().trim().min(1).optional(),
});

function instantError(error: Error) {
  if (error.message === 'INSTANT_DUPLICATE') return fail('هذه الرسالة/العملية تبدو مسجلة مسبقًا.', 409);
  if (error.message === 'PREVIEW_NOT_READY') return fail('المعاينة غير جاهزة للحفظ. عدّل الرسالة ثم أعد المحاولة.');
  if (error.message === 'PERSON_NOT_FOUND') return fail('لم يتم العثور على الزبون.', 404);
  if (error.message === 'PERSON_AMBIGUOUS') return fail('يوجد أكثر من زبون محتمل. اختر الزبون الصحيح قبل الحفظ.');
  if (error.message === 'CARD_NOT_FOUND') return fail('البطاقة غير موجودة.', 404);
  if (error.message === 'CARD_AMBIGUOUS') return fail('يوجد أكثر من بطاقة بنفس آخر 4 أرقام. حدد البطاقة من صفحة الزبون.');
  if (error.message === 'CARD_ALREADY_EXISTS') return fail('هذه البطاقة/العملية تبدو مسجلة مسبقًا.', 409);
  if (error.message === 'CARD_OPERATION_ALREADY_EXISTS') return fail('هذه السحبة تبدو مسجلة مسبقًا على نفس البطاقة.', 409);
  if (error.message === 'CARD_ALREADY_SETTLED') return fail('هذه البطاقة مصفاة بالفعل.', 409);
  if (error.message === 'DUPLICATE_LAST4_IN_BATCH') return fail('يوجد تكرار في آخر 4 أرقام داخل نفس الرسالة.');
  if (error.message === 'INVALID_CURRENCY') return fail('عملة العملية يجب أن تكون USD أو LYD.');
  if (error.message === 'INVALID_DELIVERY_AMOUNT') return fail('أدخل مبلغًا مستلمًا صحيحًا.');
  if (error.message === 'DELIVERY_OVER_REMAINING') return fail('المبلغ المستلم أكبر من المتبقي لهذا الزبون.');
  if (error.message === 'INVALID_WALLET_AMOUNT') return fail('أدخل قيمة صحيحة أكبر من الصفر.');
  if (error.message === 'NEGATIVE_WALLET_BALANCE') return fail('لا يمكن أن يصبح الرصيد بالسالب بعد هذه العملية.');
  if (error.message === 'CARD_OPERATION_OVER_REMAINING') return fail('مبلغ السحب أكبر من المتبقي في البطاقة.');
  if (error.message === 'REJECT_REASON_REQUIRED') return fail('اكتب سبب إيقاف أو رفض البطاقة.');
  return null;
}

export async function GET() {
  try {
    await requireSession();
    return ok(await instantRegistrationHistory());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return fail('اكتب رسالة التسجيل الفوري أولًا.');

    const options = { selectedPersonId: parsed.data.personId };
    if (parsed.data.confirm) return ok(await executeInstantRegistration(parsed.data.text, session, options), 201);
    return ok(await buildInstantRegistrationPreview(parsed.data.text, options));
  } catch (error) {
    const handled = instantError(error as Error);
    if (handled) return handled;
    return apiError(error);
  }
}
