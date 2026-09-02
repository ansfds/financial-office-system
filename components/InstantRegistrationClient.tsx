'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Edit3, Loader2, RotateCcw, SendHorizontal, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/format';

type Preview = {
  fingerprint: string;
  kind: string;
  kindLabel: string;
  actionLabel: string;
  ready: boolean;
  duplicate: boolean;
  warnings: string[];
  blockingIssues: string[];
  summary: string[];
};

type ExecuteResult = {
  message: string;
  fingerprint: string;
  undoAvailable: boolean;
};

type HistoryItem = {
  id: string;
  action: string;
  description?: string | null;
  newValue?: any;
  username?: string | null;
  createdAt: string | Date;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'system';
  text?: string;
  preview?: Preview;
  result?: ExecuteResult;
  error?: string;
};

const templates = [
  {
    label: 'زبون جديد',
    text: 'اسم الزبون\nرقم الهاتف\nبطاقة جمهورية\nآخر 4: 0000\nالقيمة 2000$\nالمتفق 1800$\nلم يستلم شيء',
  },
  {
    label: 'بطاقة جديدة',
    text: 'اسم الزبون\nبطاقة جديدة\nآخر 4: 0000\nالقيمة 2000$\nالمتفق 1800$',
  },
  {
    label: 'سحبة',
    text: 'بطاقة 0000 تم سحب 476$',
  },
  {
    label: 'استلام مبلغ',
    text: 'اسم الزبون استلم 500$',
  },
  {
    label: 'لنا',
    text: 'لنا على اسم الزبون 500$',
  },
  {
    label: 'علينا',
    text: 'علينا لاسم الزبون 50$',
  },
  {
    label: 'تسديد',
    text: 'تم تسديد 100$ لاسم الزبون',
  },
  {
    label: 'تصفية',
    text: '0000 صافي بالكامل',
  },
];

function uid() {
  return crypto.randomUUID();
}

function historyText(item: HistoryItem) {
  const result = item.newValue?.result;
  if (item.action === 'INSTANT_REGISTRATION_UNDO') return 'تم التراجع عن عملية تسجيل فوري';
  if (result?.message) return result.message;
  return item.description?.replace(/fingerprint:[a-f0-9]+/i, '').trim() || 'عملية تسجيل فوري';
}

export default function InstantRegistrationClient({ initialHistory }: { initialHistory: HistoryItem[] }) {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState('');
  const [undoingFingerprint, setUndoingFingerprint] = useState('');

  const lastPreview = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].preview) return messages[index].preview;
    }
    return null;
  }, [messages]);

  async function refreshHistory() {
    const response = await fetch('/api/instant-registration', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json().catch(() => []);
    if (Array.isArray(result)) setHistory(result);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (loading || !text.trim()) return;

    const submittedText = text.trim();
    const userMessage: ChatMessage = { id: uid(), role: 'user', text: submittedText };
    const systemId = uid();
    setMessages((current) => [
      ...current,
      userMessage,
      { id: systemId, role: 'system', text: 'جار تحليل الرسالة...' },
    ]);
    setText('');
    setLoading(true);

    try {
      const response = await fetch('/api/instant-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: submittedText }),
      });
      const result = await response.json().catch(() => ({}));
      setMessages((current) =>
        current.map((message) =>
          message.id === systemId
            ? response.ok
              ? { id: systemId, role: 'system', preview: result }
              : { id: systemId, role: 'system', error: result.error || 'تعذر تحليل الرسالة' }
            : message,
        ),
      );
    } catch {
      setMessages((current) =>
        current.map((message) =>
          message.id === systemId ? { id: systemId, role: 'system', error: 'تعذر الاتصال بالخادم' } : message,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirm(messageId: string, sourceText: string) {
    if (confirmingId) return;
    setConfirmingId(messageId);
    try {
      const response = await fetch('/api/instant-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText, confirm: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(result.error || 'تعذر الحفظ');
        return;
      }

      setMessages((current) =>
        current.map((message) => (message.id === messageId ? { ...message, result } : message)),
      );
      toast.success(result.message || 'تم التسجيل بنجاح');
      void refreshHistory();
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء الحفظ');
    } finally {
      setConfirmingId('');
    }
  }

  async function undo(fingerprint: string) {
    if (undoingFingerprint) return;
    setUndoingFingerprint(fingerprint);
    try {
      const response = await fetch('/api/instant-registration/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(result.error || 'تعذر التراجع');
        return;
      }

      toast.success(result.message || 'تم التراجع');
      setMessages((current) => [
        ...current,
        { id: uid(), role: 'system', text: result.message || 'تم التراجع عن التسجيل الفوري' },
      ]);
      void refreshHistory();
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء التراجع');
    } finally {
      setUndoingFingerprint('');
    }
  }

  function applyTemplate(value: string) {
    setText(value);
  }

  function lastUserTextForSystem(index: number) {
    for (let pointer = index - 1; pointer >= 0; pointer -= 1) {
      if (messages[pointer].role === 'user') return messages[pointer].text || '';
    }
    return '';
  }

  return (
    <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="flex min-h-[34rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card dark:border-blue-900/60 dark:bg-[#0d1d33]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3 dark:border-slate-800">
          <div>
            <div className="font-black">التسجيل الفوري</div>
            <div className="mt-1 text-xs font-bold text-slate-500">Parser داخلي سريع بدون AI API</div>
          </div>
          <span className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-emerald-50 px-3 text-xs font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
            <Sparkles size={15} />
            معاينة قبل الحفظ
          </span>
        </div>

        <div className="stagger-list flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 dark:bg-slate-950/40">
          {!messages.length ? (
            <div className="mx-auto grid max-w-lg place-items-center gap-3 py-10 text-center text-slate-500">
              <Sparkles size={34} />
              <div className="font-black text-slate-700 dark:text-slate-200">الصق الرسالة وسيتم تحليلها فورًا.</div>
              <div className="text-sm">التسجيل يتم فقط بعد ظهور المعاينة والضغط على التأكيد.</div>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const sourceText = lastUserTextForSystem(index);
            return (
              <article
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[92%] rounded-lg px-3 py-3 text-sm shadow-sm md:max-w-[75%] ${
                    message.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'
                  }`}
                >
                  {message.text ? <div className="whitespace-pre-wrap leading-7">{message.text}</div> : null}
                  {message.error ? <div className="font-bold text-red-600 dark:text-red-300">{message.error}</div> : null}
                  {message.preview ? (
                    <PreviewBubble
                      preview={message.preview}
                      result={message.result}
                      confirming={confirmingId === message.id}
                      undoing={undoingFingerprint === message.preview.fingerprint}
                      onConfirm={() => confirm(message.id, sourceText)}
                      onEdit={() => setText(sourceText)}
                      onUndo={() => undo(message.preview?.fingerprint || '')}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <form onSubmit={send} className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#0d1d33]">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            placeholder="اكتب أو الصق رسالة التسجيل هنا"
            className="resize-none"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {templates.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => applyTemplate(template.text)}
                className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                {template.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="truncate text-xs font-bold text-slate-500">
              {lastPreview ? `آخر معاينة: ${lastPreview.kindLabel}` : 'الأرقام العربية والإنجليزية مدعومة'}
            </div>
            <button
              disabled={loading || !text.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-black text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <SendHorizontal size={18} />}
              إرسال
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-card dark:border-blue-900/60 dark:bg-[#0d1d33]">
        <div className="mb-3 font-black">آخر العمليات</div>
        <div className="grid gap-2">
          {history.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="font-bold">{historyText(item)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {item.username || 'system'} · {formatDateTime(item.createdAt)}
              </div>
            </div>
          ))}
          {!history.length ? <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">لا توجد عمليات تسجيل فوري بعد.</div> : null}
        </div>
      </aside>
    </div>
  );
}

function PreviewBubble({
  preview,
  result,
  confirming,
  undoing,
  onConfirm,
  onEdit,
  onUndo,
}: {
  preview: Preview;
  result?: ExecuteResult;
  confirming: boolean;
  undoing: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onUndo: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          {preview.kindLabel}
        </span>
        {preview.ready ? (
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
            جاهزة للحفظ
          </span>
        ) : (
          <span className="rounded-md bg-orange-50 px-2 py-1 text-xs font-black text-orange-700 dark:bg-orange-950 dark:text-orange-200">
            تحتاج مراجعة
          </span>
        )}
      </div>

      <div className="space-y-1 leading-7">
        {preview.summary.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>

      {preview.warnings.length ? (
        <div className="mt-3 rounded-lg bg-orange-50 p-2 text-xs font-bold text-orange-700 dark:bg-orange-950 dark:text-orange-200">
          {preview.warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
        </div>
      ) : null}

      {preview.blockingIssues.length ? (
        <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-200">
          {preview.blockingIssues.map((issue, index) => (
            <div key={`${issue}-${index}`}>{issue}</div>
          ))}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          {result.message}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {!result ? (
          <>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!preview.ready || confirming}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 font-black text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {confirming ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />}
              {preview.actionLabel}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 font-black text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              <Edit3 size={17} />
              تعديل
            </button>
          </>
        ) : result.undoAvailable ? (
          <button
            type="button"
            onClick={onUndo}
            disabled={undoing}
            className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-slate-100 dark:text-slate-950"
          >
            {undoing ? <Loader2 className="animate-spin" size={17} /> : <RotateCcw size={17} />}
            تراجع
          </button>
        ) : null}
      </div>
    </div>
  );
}
