import Page from '@/components/Page';
import DailyNotesClient from '@/components/DailyNotesClient';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function DailyNotesPage() {
  await requireSession();
  const notes = await db.dailyNote.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return <Page title="الملاحظات اليومية"><DailyNotesClient initialNotes={JSON.parse(JSON.stringify(notes))} /></Page>;
}
