export type MobileDrawerAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'route-change' }
  | { type: 'escape' }
  | { type: 'overlay' }
  | { type: 'link' };

export function reduceMobileDrawerState(open: boolean, action: MobileDrawerAction) {
  if (!open && action.type !== 'open') return false;
  return action.type === 'open';
}

export function shouldCloseMobileDrawerFromDrag(deltaX: number, deltaY: number) {
  return deltaX > 56 && Math.abs(deltaY) < 60;
}
