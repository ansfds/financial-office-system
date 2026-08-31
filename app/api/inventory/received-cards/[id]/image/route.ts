import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;

    const card = await db.receivedCustomerCard.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        cardImageDataUrl: true,
        cardImageMimeType: true,
        cardImageSize: true,
        cardImageUpdatedAt: true,
      },
    });

    if (!card) return fail('البطاقة غير موجودة', 404);
    if (!card.cardImageDataUrl) return fail('لا توجد صورة أصلية لهذه البطاقة', 404);

    return ok(card);
  } catch (error) {
    return apiError(error);
  }
}
