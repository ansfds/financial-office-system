// Keep historical saved affectedPaths useful after moving the internal pages.
export function canonicalAppPath(path: string) {
  return path
    .replace(/^\/people(?=\/|[?#]|$)/, '/customers')
    .replace(/^\/accounts(?=[?#]|$)/, '/finance')
    .replace(/^\/dashboard(?=[?#]|$)/, '/');
}
