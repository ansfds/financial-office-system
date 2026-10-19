'use client';
import { ReactNode, useEffect, useRef } from 'react';
import ModalLayer, { ModalBackdrop } from './ModalLayer';
export default function CenteredDialog({
  title,
  name,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  name: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panel.current?.focus(), 30);
    return () => {
      clearTimeout(timer);
      previous?.focus();
    };
  }, []);
  function trap(event: React.KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = panel.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
    );
    if (!controls?.length) return;
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || document.activeElement === panel.current)
    ) {
      event.preventDefault();
      first.focus();
    }
  }
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <ModalLayer
      name={name}
      onClose={close}
      className="centered-dialog-layer"
      closeOnEscape={!busy}
      closeOnBack={!busy}
    >
      <ModalBackdrop onClick={close} />
      <div
        ref={panel}
        tabIndex={-1}
        onKeyDown={trap}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir="rtl"
        className="modal-panel centered-dialog-panel"
      >
        <div className="modal-header flex items-center justify-between gap-3 p-4">
          <h2 className="font-black">{title}</h2>
          <button disabled={busy} type="button" aria-label="إغلاق" onClick={close} className="modal-close">
            ×
          </button>
        </div>
        <div className="modal-body space-y-4 p-4" data-modal-scroll-body>
          {children}
        </div>
      </div>
    </ModalLayer>
  );
}
