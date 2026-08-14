export const SESSION_INACTIVITY_MINUTES = 30;
export const SESSION_WARNING_MINUTES = 5;
export const SESSION_WARNING_AT_MINUTES = SESSION_INACTIVITY_MINUTES - SESSION_WARNING_MINUTES;
export const SESSION_TOUCH_INTERVAL_MS = 3 * 60_000;

export function sessionInactivityMs() {
  return SESSION_INACTIVITY_MINUTES * 60_000;
}

export function sessionWarningAtMs() {
  return SESSION_WARNING_AT_MINUTES * 60_000;
}

export function nextSessionExpiry(activityAt: Date | number = Date.now()) {
  const time = typeof activityAt === 'number' ? activityAt : activityAt.getTime();
  return new Date(time + sessionInactivityMs());
}

export function isSessionInactive(lastActivityAt: Date | number, now: Date | number = Date.now()) {
  const lastActivity = typeof lastActivityAt === 'number' ? lastActivityAt : lastActivityAt.getTime();
  const current = typeof now === 'number' ? now : now.getTime();
  return current - lastActivity >= sessionInactivityMs();
}

export function shouldWarnForInactiveSession(lastActivityAt: Date | number, now: Date | number = Date.now()) {
  const lastActivity = typeof lastActivityAt === 'number' ? lastActivityAt : lastActivityAt.getTime();
  const current = typeof now === 'number' ? now : now.getTime();
  const idleMs = current - lastActivity;
  return idleMs >= sessionWarningAtMs() && idleMs < sessionInactivityMs();
}

export function shouldTouchSession(lastActivityAt: Date | number, now: Date | number = Date.now(), force = false) {
  if (force) return true;
  const lastActivity = typeof lastActivityAt === 'number' ? lastActivityAt : lastActivityAt.getTime();
  const current = typeof now === 'number' ? now : now.getTime();
  return current - lastActivity >= SESSION_TOUCH_INTERVAL_MS;
}
