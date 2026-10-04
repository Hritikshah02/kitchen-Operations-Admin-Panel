"use client";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** ISO weekdays (1 = Monday) as toggle chips. */
export function WeekdayPicker({ legend, value, onChange, disabled }: { legend: string; value: number[]; onChange: (days: number[]) => void; disabled?: boolean }) {
  const toggle = (day: number) => onChange(value.includes(day) ? value.filter((entry) => entry !== day) : [...value, day].sort((a, b) => a - b));
  return <fieldset className="chip-group" disabled={disabled}><legend>{legend}</legend>
    {WEEKDAYS.map((label, index) => <label className="chip" key={label}><input checked={value.includes(index + 1)} onChange={() => toggle(index + 1)} type="checkbox" />{label}</label>)}
  </fieldset>;
}

/** Multi-select over a reference list (allergens, dietary tags...) as chips. */
export function ChipSelect({ legend, options, value, onChange, disabled }: { legend: string; options: { id: number; name: string }[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
  return <fieldset className="chip-group" disabled={disabled}><legend>{legend}</legend>
    {options.map((option) => <label className="chip" key={option.id}><input checked={value.includes(option.id)} onChange={() => toggle(option.id)} type="checkbox" />{option.name}</label>)}
    {!options.length ? <span className="hint">None defined yet.</span> : null}
  </fieldset>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

/** Initials in a circle; decorative, the name is always shown next to it. */
export function Avatar({ name, small }: { name: string; small?: boolean }) {
  return <span aria-hidden="true" className={small ? "avatar sm" : "avatar"}>{initials(name)}</span>;
}

export function Pagination({ page, pageSize, total, noun, onPage }: { page: number; pageSize: number; total: number; noun: string; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><span>{total} {noun}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span><div className="form-actions">
    <button className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">Previous</button>
    <button className="secondary-button" disabled={page >= pages} onClick={() => onPage(page + 1)} type="button">Next</button>
  </div></div>;
}

export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

export const weekdayList = (days: number[]) => days.map((day) => WEEKDAYS[day - 1]).join(", ");
