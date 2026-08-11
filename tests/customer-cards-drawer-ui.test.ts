import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(file: string) {
  return readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('customer cards mobile drawer UI contract', () => {
  it('renders the customer cards drawer through a body portal above its overlay', () => {
    const peopleClient = readProjectFile('components/PeopleClient.tsx');
    const modalLayer = readProjectFile('components/ModalLayer.tsx');

    expect(modalLayer).toContain('createPortal(');
    expect(modalLayer).toContain('document.body');
    expect(peopleClient).toContain('<ModalLayer');
    expect(peopleClient).toContain('name="customer-cards"');
    expect(peopleClient).toContain("'data-customer-cards-drawer': 'root'");
    expect(peopleClient).toContain('data-customer-cards-drawer="panel"');
    expect(peopleClient).toContain('ModalBackdrop');
    expect(peopleClient).toContain('modal-panel modal-panel--drawer');
  });

  it('keeps the drawer viewport safe for mobile webviews and bottom safe areas', () => {
    const peopleClient = readProjectFile('components/PeopleClient.tsx');
    const css = readProjectFile('app/globals.css');

    expect(peopleClient).toContain('data-modal-scroll-body');
    expect(peopleClient).toContain('modal-body');
    expect(css).toContain('.modal-layer-root');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('100svh');
    expect(css).toContain('100dvh');
  });

  it('cleans up drawer state, scroll lock, Escape, and browser back handling', () => {
    const peopleClient = readProjectFile('components/PeopleClient.tsx');
    const modalLayer = readProjectFile('components/ModalLayer.tsx');

    expect(modalLayer).toContain("document.body.style.overflow = 'hidden'");
    expect(modalLayer).toContain('document.body.style.overflow = snapshot.overflow');
    expect(modalLayer).toContain("event.key !== 'Escape'");
    expect(modalLayer).toContain('window.history.pushState');
    expect(modalLayer).toContain('window.history.back');
    expect(modalLayer).toContain("window.addEventListener('popstate'");
    expect(peopleClient).toContain('setDeliveryOpen(false)');
    expect(peopleClient).toContain('setExpandedCardIds(new Set())');
  });
});
