import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(file: string) {
  return readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('customer cards mobile drawer UI contract', () => {
  it('renders the customer cards drawer through a body portal above its overlay', () => {
    const peopleClient = readProjectFile('components/PeopleClient.tsx');

    expect(peopleClient).toContain('createPortal((');
    expect(peopleClient).toContain('document.body');
    expect(peopleClient).toContain('data-customer-cards-drawer="root"');
    expect(peopleClient).toContain('data-customer-cards-drawer="panel"');
    expect(peopleClient).toContain('z-[80]');
    expect(peopleClient).toContain('z-0 bg-slate-950/45');
    expect(peopleClient).toContain('absolute inset-0 z-10');
  });

  it('keeps the drawer viewport safe for mobile webviews and bottom safe areas', () => {
    const peopleClient = readProjectFile('components/PeopleClient.tsx');
    const css = readProjectFile('app/globals.css');

    expect(peopleClient).toContain('mobile-modal-viewport');
    expect(peopleClient).toContain('overflow-y-auto overscroll-contain');
    expect(peopleClient).toContain('pb-[calc(1rem+env(safe-area-inset-bottom))]');
    expect(css).toContain('.mobile-modal-viewport');
    expect(css).toContain('100svh');
    expect(css).toContain('100dvh');
  });

  it('cleans up drawer state, scroll lock, Escape, and browser back handling', () => {
    const peopleClient = readProjectFile('components/PeopleClient.tsx');

    expect(peopleClient).toContain("document.body.style.overflow = 'hidden'");
    expect(peopleClient).toContain('document.body.style.overflow = previousOverflow');
    expect(peopleClient).toContain("event.key !== 'Escape'");
    expect(peopleClient).toContain('window.history.pushState');
    expect(peopleClient).toContain('window.history.back');
    expect(peopleClient).toContain("window.addEventListener('popstate'");
    expect(peopleClient).toContain('setDeliveryOpen(false)');
    expect(peopleClient).toContain('setExpandedCardIds(new Set())');
  });
});
