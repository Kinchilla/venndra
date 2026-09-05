"use client";

import { useState } from "react";
import type { Prisma } from "@prisma/client";
import { NOTIFICATION_TRIGGERS, type NotificationTrigger } from "../lib/notifications/triggers";
import { isEmailEnabled } from "../lib/notifications/prefs";

/**
 * One instant-save checkbox per trigger, no shared "Save" button --
 * matches CalendarSourcesPanel's toggleCheck: flip state optimistically,
 * PATCH, and flip back on failure. Each row is its own independent action,
 * so there's nothing to lose by leaving mid-edit.
 *
 * `initialPrefs` is the raw sparse JSON column, read the same way the
 * server does via isEmailEnabled -- so "on" here means exactly what "on"
 * means when a notification actually gets sent. `Prisma.JsonValue` is a
 * type-only import (Prisma generates it at the same place as the client,
 * but nothing here pulls the client itself into the browser bundle).
 */
export default function NotificationSettingsForm({ initialPrefs }: { initialPrefs: Prisma.JsonValue | null }) {
  const initial = new Map(NOTIFICATION_TRIGGERS.map((t) => [t.id, isEmailEnabled(initialPrefs, t.id)]));
  const [enabled, setEnabled] = useState(initial);
  const [errorFor, setErrorFor] = useState<NotificationTrigger | null>(null);

  async function toggle(trigger: NotificationTrigger, next: boolean) {
    setErrorFor(null);
    setEnabled((prev) => new Map(prev).set(trigger, next));

    const res = await fetch("/api/me/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger, enabled: next }),
    });

    if (!res.ok) {
      setEnabled((prev) => new Map(prev).set(trigger, !next));
      setErrorFor(trigger);
    }
  }

  return (
    <div>
      <ul className="divide-y divide-line/60">
        {NOTIFICATION_TRIGGERS.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-4 py-3">
            <div>
              <div className="text-sm text-ink/80">{t.label}</div>
              <div className="text-xs text-ink/40">{t.description}</div>
              {errorFor === t.id && <div className="mt-1 text-xs text-red-600">Couldn't save — try again.</div>}
            </div>
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={enabled.get(t.id) ?? true}
              onChange={(e) => toggle(t.id, e.target.checked)}
              aria-label={t.label}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
