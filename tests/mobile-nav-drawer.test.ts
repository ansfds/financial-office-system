import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reduceMobileDrawerState, shouldCloseMobileDrawerFromDrag } from '@/lib/mobile-nav-drawer';

describe('mobile navigation drawer', () => {
  it('starts closed and only opens from the explicit open action', () => {
    expect(reduceMobileDrawerState(false, { type: 'close' })).toBe(false);
    expect(reduceMobileDrawerState(false, { type: 'route-change' })).toBe(false);
    expect(reduceMobileDrawerState(false, { type: 'escape' })).toBe(false);
    expect(reduceMobileDrawerState(false, { type: 'overlay' })).toBe(false);
    expect(reduceMobileDrawerState(false, { type: 'link' })).toBe(false);
    expect(reduceMobileDrawerState(false, { type: 'open' })).toBe(true);
  });

  it('closes for every supported close path', () => {
    expect(reduceMobileDrawerState(true, { type: 'close' })).toBe(false);
    expect(reduceMobileDrawerState(true, { type: 'route-change' })).toBe(false);
    expect(reduceMobileDrawerState(true, { type: 'escape' })).toBe(false);
    expect(reduceMobileDrawerState(true, { type: 'overlay' })).toBe(false);
    expect(reduceMobileDrawerState(true, { type: 'link' })).toBe(false);
  });

  it('supports RTL swipe-to-close without closing on vertical scroll', () => {
    expect(shouldCloseMobileDrawerFromDrag(72, 12)).toBe(true);
    expect(shouldCloseMobileDrawerFromDrag(72, 84)).toBe(false);
    expect(shouldCloseMobileDrawerFromDrag(-72, 12)).toBe(false);
  });

  it('keeps transform ownership out of the drawer CSS animation layer', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const drawerBlock = css.match(/\.drawer-panel\s*\{([\s\S]*?)\}/)?.[1] || '';
    expect(drawerBlock).not.toMatch(/animation\s*:/);
    expect(drawerBlock).not.toMatch(/transform\s*:/);
  });

  it('keeps the Shell wired for default-close, route close, Escape, and inert closed UI', () => {
    const shell = readFileSync(path.resolve(process.cwd(), 'components/Shell.tsx'), 'utf8');
    expect(shell).toContain('useState(false)');
    expect(shell).not.toContain('useState(true)');
    expect(shell).toContain('[pathname]');
    expect(shell).toContain("event.key !== 'Escape'");
    expect(shell).toContain('pointer-events-none opacity-0');
    expect(shell).toContain('aria-expanded={mobileMenuOpen}');
  });
});
