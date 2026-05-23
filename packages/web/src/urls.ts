export function sessionHref(id: string): string {
  return `#session=${encodeURIComponent(id)}`;
}
