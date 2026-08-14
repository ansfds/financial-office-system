'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Loader2, Mic, Send, Sparkles, Square, X } from 'lucide-react';
import ModalLayer, { ModalBackdrop } from './ModalLayer';
import type { AssistantPreview, AssistantResponse } from '@/lib/smart-assistant/schema';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  preview?: AssistantPreview;
  confirmationToken?: string;
  answer?: unknown;
  dismissed?: boolean;
};

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function summarizeAnswer(answer: unknown) {
  if (!answer || typeof answer !== 'object') return null;
  const data = answer as any;
  const customer = data.customer || data.answer?.customer;
  const cards = data.cards || data.answer?.cards;
  const wallet = data.wallet || data.answer?.wallet;
  const logs = data.logs || data.answer?.logs;

  return {
    customer,
    cards: Array.isArray(cards) ? cards.slice(0, 12) : undefined,
    wallet: Array.isArray(wallet) ? wallet.slice(0, 12) : undefined,
    logs: Array.isArray(logs) ? logs.slice(0, 8) : undefined,
  };
}

function PreviewCard({
  preview,
  token,
  confirming,
  onConfirm,
  onEdit,
  onCancel,
}: {
  preview: AssistantPreview;
  token: string;
  confirming: boolean;
  onConfirm: (token: string) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-black text-indigo-800 dark:text-blue-100">{preview.actionLabel}</div>
          {preview.customer ? (
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {preview.customer.name}
              {preview.customer.code ? ` - ${preview.customer.code}` : ''}
            </div>
          ) : null}
        </div>
        <Sparkles className="mt-1 h-5 w-5 text-indigo-600 dark:text-blue-300" />
      </div>

      <div className="grid gap-2">
        {preview.lines.map((line) => (
          <div key={`${line.label}-${line.value}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 dark:bg-slate-950/40">
            <span className="text-slate-500 dark:text-slate-400">{line.label}</span>
            <span className="num text-left font-bold">{line.value}</span>
          </div>
        ))}
      </div>

      {preview.cards?.length ? (
        <div className="mt-3 space-y-2">
          {preview.cards.slice(0, 8).map((card, index) => (
            <div key={`${card.id || card.publicCode || index}`} className="rounded-lg border border-white/80 bg-white/70 p-2 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold">{card.publicCode || `بطاقة ${index + 1}`}</span>
                <span className="num">{card.cardLast4 || 'بدون آخر 4'}</span>
              </div>
              {card.balanceBefore || card.balanceAfter ? (
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  قبل: <span className="num">{card.balanceBefore}</span> - بعد: <span className="num">{card.balanceAfter}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {preview.warnings.length ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {preview.warnings.join(' - ')}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={confirming}
          onClick={() => onConfirm(token)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          تأكيد التنفيذ
        </button>
        <button
          type="button"
          disabled={confirming}
          onClick={onEdit}
          className="rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100"
        >
          تعديل
        </button>
        <button
          type="button"
          disabled={confirming}
          onClick={onCancel}
          className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-300 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-100"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

export default function SmartAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 40);
  }, [messages, open]);

  function append(message: Omit<ChatMessage, 'id'>) {
    setMessages((current) => [...current.slice(-15), { id: messageId(), ...message }]);
  }

  async function submitCommand(commandText = input) {
    const command = commandText.trim();
    if (!command || loading) return;

    setLoading(true);
    append({ role: 'user', content: command });
    setInput('');

    try {
      const history = messages.slice(-6).map((message) => ({ role: message.role, content: message.content }));
      const response = await fetch('/api/assistant/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ command, history }),
      });
      const data: AssistantResponse | { error?: string } = await response.json();
      if (!response.ok || ('error' in data && data.error)) {
        const errorMessage = 'error' in data ? data.error : undefined;
        append({ role: 'assistant', content: errorMessage || 'تعذر إرسال الأمر للمساعد.' });
        return;
      }

      const assistantData = data as AssistantResponse;
      if (assistantData.type === 'preview') {
        append({ role: 'assistant', content: assistantData.message, preview: assistantData.preview, confirmationToken: assistantData.confirmationToken });
      } else if (assistantData.type === 'answer') {
        append({ role: 'assistant', content: assistantData.message, answer: assistantData.answer });
      } else {
        append({ role: 'assistant', content: assistantData.message });
      }
    } catch {
      append({ role: 'assistant', content: 'تعذر الاتصال بالمساعد الآن.' });
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction(token: string) {
    if (confirmingToken) return;
    setConfirmingToken(token);
    try {
      const response = await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ confirmationToken: token }),
      });
      const data = await response.json();
      if (!response.ok) {
        append({ role: 'assistant', content: data.error || 'تعذر تنفيذ المعاينة.' });
        return;
      }
      append({ role: 'assistant', content: data.message || 'تم التنفيذ.' });
    } catch {
      append({ role: 'assistant', content: 'تعذر تنفيذ العملية الآن.' });
    } finally {
      setConfirmingToken(null);
    }
  }

  async function transcribeAudio(blob: Blob) {
    setTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'assistant-command.webm');
      const response = await fetch('/api/assistant/transcribe', {
        method: 'POST',
        body: formData,
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) {
        append({ role: 'assistant', content: data.error || 'تعذر تحويل الصوت إلى نص.' });
        return;
      }
      setInput(data.text || '');
      append({ role: 'assistant', content: data.text ? `النص المحول من الصوت: ${data.text}` : 'لم أسمع نصًا واضحًا.' });
    } catch {
      append({ role: 'assistant', content: 'تعذر تحويل الصوت إلى نص الآن.' });
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    if (recording || transcribing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      append({ role: 'assistant', content: 'التسجيل الصوتي غير مدعوم في هذا المتصفح.' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (blob.size > 0) void transcribeAudio(blob);
      };
      recorder.start();
      setRecording(true);
    } catch {
      append({ role: 'assistant', content: 'لم أستطع تشغيل الميكروفون. تحقق من صلاحية المتصفح.' });
    }
  }

  function stopRecording() {
    if (!recording) return;
    setRecording(false);
    recorderRef.current?.stop();
  }

  function closeSheet() {
    if (recording) stopRecording();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(5.9rem+env(safe-area-inset-bottom))] left-3 z-30 inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-xl hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 lg:bottom-6 lg:left-6"
      >
        <Bot className="h-5 w-5" />
        المساعد الذكي
      </button>

      {open ? (
        <ModalLayer name="smart-assistant" onClose={closeSheet} className="smart-assistant-layer">
          <ModalBackdrop onClick={closeSheet} />
          <section className="modal-panel h-[100dvh] max-h-[100dvh] max-w-2xl md:h-auto md:max-h-[min(92vh,48rem)]">
            <header className="modal-header flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-600 text-white dark:bg-blue-600">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-black">المساعد الذكي</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">معاينة آمنة قبل أي تنفيذ</div>
                </div>
              </div>
              <button type="button" onClick={closeSheet} className="modal-close bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-100" aria-label="إغلاق المساعد">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div ref={scrollRef} data-modal-scroll-body className="modal-body space-y-3 p-3 sm:p-4">
              {!messages.length ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm leading-7 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  اكتب أمرًا مثل: اعرض رصيد #A001، أو سجل كرت 500 للبطاقة 3558، أو أضف دينًا لنا بقيمة 40 دولار. عمليات الكتابة ستظهر كمعاينة قبل التنفيذ.
                </div>
              ) : null}

              {messages.map((message) => {
                const answerSummary = summarizeAnswer(message.answer);
                return (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[92%] rounded-lg px-3 py-2 text-sm leading-7 ${
                        message.role === 'user'
                          ? 'bg-indigo-600 text-white dark:bg-blue-600'
                          : 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-100'
                      }`}
                    >
                      <div>{message.content}</div>
                      {answerSummary ? (
                        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-white/70 p-2 text-xs leading-6 text-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                          {JSON.stringify(answerSummary, null, 2)}
                        </pre>
                      ) : null}
                      {message.preview && message.confirmationToken && !message.dismissed ? (
                        <PreviewCard
                          preview={message.preview}
                          token={message.confirmationToken}
                          confirming={confirmingToken === message.confirmationToken}
                          onConfirm={confirmAction}
                          onEdit={() => setInput(message.preview?.originalCommand || '')}
                          onCancel={() => {
                            setMessages((current) =>
                              current.map((item) => (item.id === message.id ? { ...item, dismissed: true } : item)),
                            );
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {loading || transcribing ? (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {transcribing ? 'تحويل الصوت...' : 'يفهم الأمر...'}
                  </div>
                </div>
              ) : null}
            </div>

            <form
              className="modal-footer grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCommand();
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={2}
                placeholder="اكتب الأمر هنا..."
                className="max-h-32 resize-none"
              />
              <div className="grid grid-cols-[auto_auto_1fr] gap-2">
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  disabled={loading || transcribing}
                  className={`inline-flex items-center justify-center rounded-lg px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                    recording ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-800 dark:bg-slate-800'
                  }`}
                  aria-label={recording ? 'إيقاف التسجيل' : 'تسجيل صوت'}
                >
                  {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <button
                  type="submit"
                  disabled={loading || transcribing || !input.trim()}
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
                <div className="flex items-center rounded-lg bg-slate-100 px-3 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  لا يتم التنفيذ إلا بعد التأكيد
                </div>
              </div>
            </form>
          </section>
        </ModalLayer>
      ) : null}
    </>
  );
}
