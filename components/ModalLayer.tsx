'use client';

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

type ModalLayerProps = {
  children: ReactNode;
  onClose: () => void;
  name: string;
  className?: string;
  closeOnEscape?: boolean;
  closeOnBack?: boolean;
  closeOnRouteChange?: boolean;
  rootProps?: Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'> &
    Record<`data-${string}`, string | undefined>;
};

type ScrollLockSnapshot = {
  scrollX: number;
  scrollY: number;
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  paddingRight: string;
};

const modalStack: string[] = [];
let lockCount = 0;
let scrollSnapshot: ScrollLockSnapshot | null = null;

function restoreWindowScroll(snapshot: Pick<ScrollLockSnapshot, 'scrollX' | 'scrollY'>) {
  const previousScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';

  const scrollNow = () => window.scrollTo({ left: snapshot.scrollX, top: snapshot.scrollY, behavior: 'auto' });
  scrollNow();
  window.requestAnimationFrame(scrollNow);
  window.setTimeout(scrollNow, 60);
  window.setTimeout(scrollNow, 180);
  window.setTimeout(scrollNow, 300);
  window.setTimeout(() => {
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
  }, 360);
}

function lockBodyScroll() {
  if (typeof window === 'undefined') return () => null;

  lockCount += 1;
  if (lockCount === 1) {
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    scrollSnapshot = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      paddingRight: document.body.style.paddingRight,
    };

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollSnapshot.scrollY}px`;
    document.body.style.left = `-${scrollSnapshot.scrollX}px`;
    document.body.style.right = '0';
    document.body.style.width = '100%';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount > 0 || !scrollSnapshot) return;

    const snapshot = scrollSnapshot;
    scrollSnapshot = null;
    document.body.style.overflow = snapshot.overflow;
    document.body.style.position = snapshot.position;
    document.body.style.top = snapshot.top;
    document.body.style.left = snapshot.left;
    document.body.style.right = snapshot.right;
    document.body.style.width = snapshot.width;
    document.body.style.paddingRight = snapshot.paddingRight;
    restoreWindowScroll(snapshot);
  };
}

function topModalId() {
  return modalStack[modalStack.length - 1];
}

function createModalId(name: string) {
  return `${name}-${Math.random().toString(36).slice(2)}`;
}

function viewportStyle(): CSSProperties {
  if (typeof window === 'undefined' || !window.visualViewport) return {};
  return {
    '--modal-visual-top': `${window.visualViewport.offsetTop}px`,
    '--modal-visual-height': `${window.visualViewport.height}px`,
  } as CSSProperties;
}

export default function ModalLayer({
  children,
  onClose,
  name,
  className = '',
  closeOnEscape = true,
  closeOnBack = true,
  closeOnRouteChange = true,
  rootProps,
}: ModalLayerProps) {
  const pathname = usePathname();
  const id = useMemo(() => createModalId(name), [name]);
  const onCloseRef = useRef(onClose);
  const pushedHistoryRef = useRef(false);
  const routeReadyRef = useRef(false);
  const previousScrollRestorationRef = useRef<ScrollRestoration | null>(null);
  const [mounted, setMounted] = useState(false);
  const [stackIndex, setStackIndex] = useState(0);
  const [style, setStyle] = useState<CSSProperties>({});

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    modalStack.push(id);
    setStackIndex(modalStack.length - 1);
    const unlock = lockBodyScroll();

    return () => {
      const index = modalStack.indexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
      unlock();
    };
  }, [id, mounted]);

  useEffect(() => {
    if (!mounted || !closeOnBack || typeof window === 'undefined') return;

    previousScrollRestorationRef.current = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.history.pushState({ ...(window.history.state || {}), fosModalLayer: id }, '', window.location.href);
    pushedHistoryRef.current = true;

    function handlePopState() {
      if (!pushedHistoryRef.current || topModalId() !== id) return;
      pushedHistoryRef.current = false;
      onCloseRef.current();
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      const restoreHistoryScroll = () => {
        if (previousScrollRestorationRef.current) {
          window.history.scrollRestoration = previousScrollRestorationRef.current;
          previousScrollRestorationRef.current = null;
        }
      };

      if (!pushedHistoryRef.current) {
        restoreHistoryScroll();
        return;
      }

      pushedHistoryRef.current = false;
      if (window.history.state?.fosModalLayer === id) {
        window.history.back();
        window.setTimeout(restoreHistoryScroll, 120);
        return;
      }

      restoreHistoryScroll();
    };
  }, [closeOnBack, id, mounted]);

  useEffect(() => {
    if (!mounted || !closeOnEscape) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || topModalId() !== id) return;
      event.preventDefault();
      onCloseRef.current();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, id, mounted]);

  useEffect(() => {
    if (!routeReadyRef.current) {
      routeReadyRef.current = true;
      return;
    }
    if (closeOnRouteChange) onCloseRef.current();
  }, [closeOnRouteChange, pathname]);

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;

    function syncViewport() {
      setStyle(viewportStyle());
    }

    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('orientationchange', syncViewport);

    return () => {
      window.visualViewport?.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    function keepFocusedControlVisible(event: FocusEvent) {
      const target = event.target as HTMLElement | null;
      const scrollBody = target?.closest('[data-modal-scroll-body]');
      if (!target || !scrollBody) return;
      window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }, 80);
    }

    document.addEventListener('focusin', keepFocusedControlVisible);
    return () => document.removeEventListener('focusin', keepFocusedControlVisible);
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      {...rootProps}
      data-modal-layer="root"
      data-modal-name={name}
      className={`modal-layer-root ${className}`}
      style={{ ...style, zIndex: 90 + stackIndex * 10 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ModalBackdrop({
  className = '',
  'aria-label': ariaLabel = 'إغلاق النافذة',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`modal-backdrop sheet-backdrop ${className}`}
      {...props}
    />
  );
}
