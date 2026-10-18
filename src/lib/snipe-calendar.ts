/** "Add to calendar" for a snipe: a calendar file for the phone's own calendar, or a Google Calendar link. */
const HOUR = 3_600_000;
/** Check-in opens this long before a snipe and closes this long after it starts (as on the server). */
export const CHECKIN_OPENS_BEFORE_MS = 30 * 60 * 1000;
export const CHECKIN_CLOSES_AFTER_MS = 3 * HOUR;

export function checkInOpen(startsAt: string, now = Date.now()): boolean {
  const start = new Date(startsAt).getTime();
  return now >= start - CHECKIN_OPENS_BEFORE_MS && now <= start + CHECKIN_CLOSES_AFTER_MS;
}

/** 20261021T100000Z */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, (character) => `\\${character}`);
}

export interface CalendarText { summary: string; description: string }

/** A one-hour event at the snipe's start (UTC), with a reminder 30 minutes before, when check-in opens. */
export function snipeCalendarFile(plan: { id: string; startsAt: string }, text: CalendarText, link: string): string {
  const start = new Date(plan.startsAt);
  const end = new Date(start.getTime() + HOUR);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Turmoil Clan Hub//Snipes//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${plan.id}@turmoil-clan-hub`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(text.summary)}`, `DESCRIPTION:${escape(text.description)}`, `URL:${link}`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", `DESCRIPTION:${escape(text.summary)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

/** Saves the calendar file; phones offer to add it to their calendar. */
export function downloadCalendarFile(fileName: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function googleCalendarLink(plan: { startsAt: string }, text: CalendarText): string {
  const start = new Date(plan.startsAt);
  const end = new Date(start.getTime() + HOUR);
  const query = new URLSearchParams({ action: "TEMPLATE", text: text.summary, dates: `${stamp(start)}/${stamp(end)}`, details: text.description });
  return `https://calendar.google.com/calendar/render?${query}`;
}
