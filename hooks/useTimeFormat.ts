"use client";

import { useEffect, useState } from "react";
import { detectTimeFormat, saveTimeFormat, type TimeFormat } from "../lib/timeFormat";

/**
 * The user's 12h/24h preference, read once on mount.
 *
 * Every component that shows a time needs this, and before #30 only
 * EventResults had it -- which is why the same confirmed event rendered
 * differently on /events and /events/[id]. See lib/timeFormat.
 *
 * WHY IT STARTS AT "12h" RATHER THAN THE REAL ANSWER. The real answer lives in
 * localStorage and in Intl, neither of which exists on the server. Reading
 * either during the first render would produce markup the server cannot
 * reproduce, and hydrating a mismatch is a crash rather than a cosmetic
 * problem -- the same hazard hooks/useClientValue exists for, and the reason
 * EventResults already did it this way.
 *
 * So the first pass renders the default, and the effect below corrects it
 * immediately afterwards. A component whose formatted output would be VISIBLE
 * on that first pass still needs useClientValue on top; one whose data arrives
 * from a fetch (EventResults' slot rows) has nothing on screen to be wrong yet
 * and does not.
 *
 * Not synchronised across simultaneously-mounted components -- there is no
 * such case today, since the toggle lives on the event page and the chips live
 * on the list page. If one ever appears, lib/calendarEvents is the pattern
 * this project already uses for that, rather than a storage-event listener.
 */
export function useTimeFormat(): [TimeFormat, (next: TimeFormat) => void] {
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("12h");

  useEffect(() => {
    setTimeFormat(detectTimeFormat());
  }, []);

  function changeTimeFormat(next: TimeFormat) {
    setTimeFormat(next);
    saveTimeFormat(next);
  }

  return [timeFormat, changeTimeFormat];
}
