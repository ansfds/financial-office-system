'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/format';
import { apiFetch, readApiJson } from '@/lib/api-client';
export default function DailyNotesClient({ initialNotes }: { initialNotes: any[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [selected, setSelected] = useState<any>(null),
    [title, setTitle] = useState(''),
    [content, setContent] = useState(''),
    [busy, setBusy] = useState(false);
  const dirty = title !== (selected?.title || '') || content !== (selected?.content || '');
  useEffect(() => setNotes(initialNotes), [initialNotes]);
  useEffect(() => {
    function leave(e: BeforeUnloadEvent) {
      if (dirty) e.preventDefault();
    }
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  function open(note: any) {
    if (busy || (dirty && !confirm('توجد تعديلات غير محفوظة. تجاهلها؟'))) return;
    setSelected(note);
    setTitle(note?.title || '');
    setContent(note?.content || '');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiFetch(selected ? `/api/daily-notes/${selected.id}` : '/api/daily-notes', {
        method: selected ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, updatedAt: selected?.updatedAt }),
      });
      const result = await readApiJson(r);
      if (!r.ok) throw new Error(result.error);
      setSelected(result);
      setTitle(result.title);
      setContent(result.content);
      setNotes((current) =>
        [result, ...current.filter((n) => n.id !== result.id)].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
      toast.success('تم حفظ المذكرة');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!selected || busy || !confirm('حذف هذه المذكرة نهائيًا؟')) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/daily-notes/${selected.id}`, { method: 'DELETE' });
      const result = await readApiJson(r);
      if (!r.ok) throw new Error(result.error || 'تعذر الحذف');
      setNotes((current) => current.filter((n) => n.id !== selected.id));
      setSelected(null);
      setTitle('');
      setContent('');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="card max-h-[65vh] overflow-auto p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-black">المحفوظات</h2>
          <button disabled={busy} onClick={() => open(null)} className="text-sm font-bold text-blue-700">
            + مذكرة جديدة
          </button>
        </div>
        <div className="space-y-2">
          {notes.map((n) => (
            <button
              key={n.id}
              disabled={busy}
              onClick={() => open(n)}
              className={`w-full rounded-lg border p-3 text-right ${selected?.id === n.id ? 'border-blue-500 bg-blue-50 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <div className="truncate text-sm font-bold">{n.title}</div>
              <div className="mt-1 text-xs text-slate-500">{formatDateTime(n.createdAt)}</div>
              <div className="text-xs text-slate-500">آخر تعديل: {formatDateTime(n.updatedAt)}</div>
            </button>
          ))}
          {!notes.length && <p className="text-sm text-slate-500">لا توجد مذكرات محفوظة.</p>}
        </div>
      </aside>
      <form onSubmit={save} className="card space-y-4 p-4">
        <label className="block font-bold">
          عنوان المذكرة
          <input
            required
            maxLength={200}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          المحتوى
          <textarea
            className="mt-2 min-h-[360px] w-full resize-y leading-8"
            maxLength={100000}
            value={content}
            disabled={busy}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-4">
          <button disabled={busy} className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white">
            {busy ? 'جار التنفيذ…' : 'حفظ'}
          </button>
          {selected && (
            <button type="button" disabled={busy} onClick={remove} className="text-red-700">
              حذف
            </button>
          )}
          <span className="text-xs text-slate-500">
            {dirty ? 'تعديلات غير محفوظة' : selected ? `محفوظة · ${selected.createdBy}` : 'مذكرة جديدة'}
          </span>
        </div>
      </form>
    </div>
  );
}
