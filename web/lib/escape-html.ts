// Minimal HTML entity escaping for interpolating untrusted values into HTML
// (e.g. email templates). Covers the five characters that can break out of
// text/attribute context.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
