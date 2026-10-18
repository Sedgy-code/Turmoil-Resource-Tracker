/**
 * Where to go after signing in with Discord: back to the page the member's link opened (a reminder's
 * link to the resource form, say). Only a page of this app qualifies, never another site or an API
 * route; anything else goes to Home.
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (value === "/api" || value.startsWith("/api/") || value.startsWith("/api?")) return "/";
  return value;
}

/** The sign-in link for a page: "/api/auth/login", plus "?next=…" unless the page is Home. */
export function loginHref(returnTo: string): string {
  const next = safeReturnPath(returnTo);
  return next === "/" ? "/api/auth/login" : `/api/auth/login?next=${encodeURIComponent(next)}`;
}
