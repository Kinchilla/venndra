"use client";

import { useEffect, useRef, useState } from "react";

export default function EmailListInput({
  emails,
  onChange,
}: {
  emails: string[];
  onChange: (emails: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (draft.trim().length === 0) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(draft.trim())}`);
        const data = await res.json();
        setSuggestions((data.emails ?? []).filter((e: string) => !emails.includes(e)));
      } catch {
        setSuggestions([]);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function addEmail(email: string) {
    if (!emails.includes(email)) onChange([...emails, email]);
    setDraft("");
    setSuggestions([]);
  }

  function commit() {
    const trimmed = draft.trim().replace(/,$/, "");
    if (trimmed && /^\S+@\S+\.\S+$/.test(trimmed) && !emails.includes(trimmed)) {
      onChange([...emails, trimmed]);
    }
    setDraft("");
    setSuggestions([]);
  }

  return (
    <div className="relative">
      <div className="rounded-lg border border-line px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {emails.map((email) => (
            <span key={email} className="flex items-center gap-1 rounded-full bg-teal/10 px-2.5 py-1 text-xs text-teal">
              {email}
              <button type="button" onClick={() => onChange(emails.filter((e) => e !== email))} aria-label={`Remove ${email}`}>
                ×
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSuggestions([]);
                return;
              }
              if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            placeholder={emails.length === 0 ? "friend@email.com" : "add another…"}
            className="min-w-[10ch] flex-1 py-1 text-sm outline-none"
          />
        </div>
      </div>

      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-lg border border-line bg-white text-sm shadow-sm">
          {suggestions.map((email) => (
            <li key={email}>
              <button
                type="button"
                // onMouseDown (not onClick) fires before the input's onBlur,
                // so selecting a suggestion doesn't get pre-empted by the
                // blur-triggered commit() clearing the draft first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  addEmail(email);
                }}
                className="block w-full px-3 py-1.5 text-left text-ink/80 hover:bg-paper"
              >
                {email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
