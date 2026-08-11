import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(file: string) {
  return readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('mobile dialog system contract', () => {
  it('centralizes dialogs in a body portal with safe scroll, history, and keyboard handling', () => {
    const modalLayer = readProjectFile('components/ModalLayer.tsx');
    const css = readProjectFile('app/globals.css');

    expect(modalLayer).toContain('createPortal(');
    expect(modalLayer).toContain('document.body');
    expect(modalLayer).toContain('lockBodyScroll');
    expect(modalLayer).toContain("document.body.style.position = 'fixed'");
    expect(modalLayer).toContain('restoreWindowScroll(snapshot)');
    expect(modalLayer).toContain('window.requestAnimationFrame');
    expect(modalLayer).toContain("document.documentElement.style.scrollBehavior = 'auto'");
    expect(modalLayer).toContain("window.history.scrollRestoration = 'manual'");
    expect(modalLayer).toContain('window.history.scrollRestoration = previousScrollRestorationRef.current');
    expect(modalLayer).toContain('window.visualViewport');
    expect(modalLayer).toContain("window.addEventListener('popstate'");
    expect(modalLayer).toContain("event.key !== 'Escape'");
    expect(modalLayer).toContain('topModalId()');
    expect(modalLayer).toContain('zIndex: 90 + stackIndex * 10');

    expect(css).toContain('.modal-layer-root');
    expect(css).toContain('.modal-backdrop');
    expect(css).toContain('.modal-panel');
    expect(css).toContain('.modal-body');
    expect(css).toContain('.modal-footer');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('100dvh');
  });

  it('moves transaction and account dialogs to the shared modal layer', () => {
    const modalFiles = [
      ['components/FastCardEntryModal.tsx', 'name="fast-card-entry"'],
      ['components/CardOperationModal.tsx', 'name="card-operation"'],
      ['components/CustomerDeliveryModal.tsx', 'name="customer-delivery"'],
      ['components/AccountsClient.tsx', 'name="wallet-movement"'],
      ['components/AccountsClient.tsx', 'name="account-details"'],
      ['components/CustomerWalletClient.tsx', 'name="customer-wallet-action"'],
      ['components/NewTransaction.tsx', 'name="new-transaction-customer"'],
      ['components/TransactionsClient.tsx', 'name="transaction-editor"'],
      ['components/TransactionsClient.tsx', 'name="transaction-note"'],
      ['components/SheinCardsClient.tsx', 'name="shein-card-send"'],
      ['components/PeopleClient.tsx', 'name="customer-cards"'],
      ['components/PeopleClient.tsx', 'name="edit-person"'],
    ] as const;

    for (const [file, modalName] of modalFiles) {
      const source = readProjectFile(file);
      expect(source).toContain('<ModalLayer');
      expect(source).toContain('<ModalBackdrop');
      expect(source).toContain(modalName);
      expect(source).toContain('modal-panel');
      expect(source).toContain('data-modal-scroll-body');
    }
  });

  it('does not leave page-scoped fixed transaction overlays outside the shell drawer', () => {
    const files = [
      'components/FastCardEntryModal.tsx',
      'components/CardOperationModal.tsx',
      'components/CustomerDeliveryModal.tsx',
      'components/AccountsClient.tsx',
      'components/CustomerWalletClient.tsx',
      'components/NewTransaction.tsx',
      'components/TransactionsClient.tsx',
      'components/SheinCardsClient.tsx',
      'components/PeopleClient.tsx',
      'components/DangerSettings.tsx',
    ];

    for (const file of files) {
      expect(readProjectFile(file)).not.toContain('fixed inset-0');
    }
  });
});
