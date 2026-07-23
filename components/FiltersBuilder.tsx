"use client";

import { useEffect, useState } from "react";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

type Rule = { id: string; days: string[]; start: string; end: string };
export type WeeklyHours = Record<string, [string, string][]>;

function rulesToWeeklyHours(rules: Rule[]): WeeklyHours {
  const out: WeeklyHours = {};
  for (const rule of rules) {
    for (const day of rule.days) {
      if (!out[day]) out[day] = [];
      out[day].push([rule.start, rule.end]);
    }
  }
  return out;
}

export default function FiltersBuilder({
  initial,
  onChange,
}: {
  initial?: WeeklyHours;
  onChange: (weeklyHours: WeeklyHours) => void;
}) {
  const [rules, setRules] = useState<Rule[]>(() => {
    if (initial && Object.keys(initial).length > 0) {
      // collapse an existing weeklyHours object back into editable rules,
      // one rule per unique (start,end) pair
      const byWindow = new Map<string, string[]>();
      for (const [day, windows] of Object.entries(initial)) {
        for (const [start, end] of windows) {
          const key = `${start}-${end}`;
          if (!byWindow.has(key)) byWindow.set(key, []);
          byWindow.get(key)!.push(day);
        }
      }
      return [...byWindow.entries()].map(([key, days], i) => {
        const [start, end] = key.split("-");
        return { id: String(i), days, start, end };
      });
    }
    return [{ id: "0", days: ["mon", "tue", "wed", "thu", "fri"], start: "18:00", end: "22:00" }];
  });

  // The rules above are what the form VISUALLY shows from the moment it
  // mounts -- but the parent's own state starts out empty until something
  // calls onChange. Without this, a form nobody touched would submit an
  // empty filter set instead of the default that's actually on screen.
  useEffect(() => {
    onChange(rulesToWeeklyHours(rules));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(next: Rule[]) {
    setRules(next);
    onChange(rulesToWeeklyHours(next));
  }

  function addRule() {
    update([...rules, { id: crypto.randomUUID(), days: ["sat", "sun"], start: "10:00", end: "18:00" }]);
  }

  function removeRule(id: string) {
    update(rules.filter((r) => r.id !== id));
  }

  function toggleDay(ruleId: string, day: string) {
    update(
      rules.map((r) =>
        r.id === ruleId ? { ...r, days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day] } : r
      )
    );
  }

  function setTime(ruleId: string, field: "start" | "end", value: string) {
    update(rules.map((r) => (r.id === ruleId ? { ...r, [field]: value } : r)));
  }

  return (
    <div className="grid gap-3">
      {rules.map((rule) => (
        <div key={rule.id} className="rounded-xl border border-line bg-paper/50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button
                type="button"
                key={d.key}
                onClick={() => toggleDay(rule.id, d.key)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  rule.days.includes(d.key) ? "border-amber bg-amber/10 text-amber" : "border-line text-ink/50 hover:border-amber hover:text-amber"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="time"
              value={rule.start}
              onChange={(e) => setTime(rule.id, "start", e.target.value)}
              className="rounded-lg border border-line px-2 py-1.5"
            />
            <span className="text-ink/40">to</span>
            <input
              type="time"
              value={rule.end}
              onChange={(e) => setTime(rule.id, "end", e.target.value)}
              className="rounded-lg border border-line px-2 py-1.5"
            />
            {rules.length > 1 && (
              <button type="button" onClick={() => removeRule(rule.id)} className="ml-auto text-xs text-ink/40 hover:text-red-600">
                remove
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" onClick={addRule} className="w-fit text-xs text-teal hover:underline">
        + add another window (e.g. weekends too)
      </button>
    </div>
  );
}
