// Dates and times are shown in the kitchen's timezone, whatever the browser's timezone is.
export const KITCHEN_TZ = "Asia/Kolkata";

export const formatDay = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

export const formatInstant = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-IN", { timeZone: KITCHEN_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—";

export const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

export const formatTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: KITCHEN_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—";

/** Today's date in the kitchen's timezone as YYYY-MM-DD. */
export const kitchenToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: KITCHEN_TZ }).format(new Date());

export const shiftDay = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
