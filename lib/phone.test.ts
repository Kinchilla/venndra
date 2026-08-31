import { describe, it, expect } from "vitest";
import {
  findCountry,
  digitsOf,
  formatNational,
  nationalDigits,
  parsePhone,
  formatE164ForDisplay,
  flagEmoji,
  DEFAULT_COUNTRY,
} from "./phone";

/**
 * Characterization tests: these pin what this module does TODAY, so #30's
 * refactor can tell whether it moved. They are not a specification of what it
 * ought to do -- where current behaviour looks arguable, the test records the
 * behaviour and says so in a comment rather than asserting a preference.
 *
 * phone.ts is the best target in the codebase for this: zero imports, so
 * nothing has to be stubbed, and #2 and #22 are both about to build on it.
 */

describe("digitsOf", () => {
  it("keeps only digits", () => {
    expect(digitsOf("(555) 123-4567")).toBe("5551234567");
    expect(digitsOf("+1 555 123 4567")).toBe("15551234567");
  });

  it("returns an empty string when there are no digits at all", () => {
    expect(digitsOf("")).toBe("");
    expect(digitsOf("not a phone number")).toBe("");
  });
});

describe("findCountry", () => {
  it("finds a country by exact ISO code", () => {
    expect(findCountry("US")?.dial).toBe("1");
    expect(findCountry("GB")?.dial).toBe("44");
  });

  it("returns undefined for anything it doesn't know", () => {
    expect(findCountry("ZZ")).toBeUndefined();
    expect(findCountry(null)).toBeUndefined();
    expect(findCountry(undefined)).toBeUndefined();
  });

  // Pinned deliberately: lookup is case-SENSITIVE. Every caller passes a code
  // straight from COUNTRIES so this never bites today, but it is exactly the
  // kind of assumption a consolidation pass might quietly change.
  it("is case-sensitive", () => {
    expect(findCountry("us")).toBeUndefined();
  });

  it("has a default country that actually exists", () => {
    expect(findCountry(DEFAULT_COUNTRY)).toBeDefined();
  });
});

describe("formatNational", () => {
  it("formats NANP numbers progressively while being typed", () => {
    expect(formatNational("", "US")).toBe("");
    expect(formatNational("5", "US")).toBe("5");
    expect(formatNational("555", "US")).toBe("555");
    expect(formatNational("5551", "US")).toBe("(555) 1");
    expect(formatNational("555123", "US")).toBe("(555) 123");
    expect(formatNational("5551234567", "US")).toBe("(555) 123-4567");
  });

  it("stops at 10 digits so a pasted country code can't push formatting off the end", () => {
    expect(formatNational("15551234567", "US")).toBe("(155) 512-3456");
  });

  it("leaves non-NANP numbers as bare digits", () => {
    expect(formatNational("2071234567", "GB")).toBe("2071234567");
  });

  it("treats every +1 country as NANP, not just the US", () => {
    expect(formatNational("5551234567", "CA")).toBe("(555) 123-4567");
  });
});

describe("nationalDigits", () => {
  it("strips the dial code from a stored E.164 number", () => {
    expect(nationalDigits("+15551234567", "US")).toBe("5551234567");
    expect(nationalDigits("+442071234567", "GB")).toBe("2071234567");
  });

  it("handles multi-digit dial codes", () => {
    // +353 is three digits of prefix; a naive single-digit strip would be wrong.
    expect(nationalDigits("+353871234567", "IE")).toBe("871234567");
  });

  it("returns all digits unchanged when the number doesn't start with the dial code", () => {
    expect(nationalDigits("5551234567", "US")).toBe("5551234567");
  });

  // A sharp edge, pinned rather than endorsed: the check is a plain
  // startsWith, so a number whose FIRST DIGIT happens to equal the dial code
  // loses it, dial code present or not. Harmless today because no NANP area
  // code begins with 1 -- but it is a real assumption, and the kind of thing
  // that stops being true if a country with dial code "5" is ever added.
  it("strips a leading digit that merely looks like the dial code", () => {
    expect(nationalDigits("1551234567", "US")).toBe("551234567");
  });

  it("returns all digits when the country is unknown", () => {
    expect(nationalDigits("+15551234567", "ZZ")).toBe("15551234567");
  });
});

describe("parsePhone", () => {
  it("accepts a plain 10-digit NANP number", () => {
    expect(parsePhone("5551234567", "US")).toEqual({ ok: true, e164: "+15551234567" });
  });

  it("accepts the same number however it was punctuated", () => {
    for (const input of ["(555) 123-4567", "555-123-4567", "555 123 4567", " 5551234567 "]) {
      expect(parsePhone(input, "US")).toEqual({ ok: true, e164: "+15551234567" });
    }
  });

  it("drops a duplicated country code rather than rejecting it", () => {
    // The single most likely paste from a contacts app.
    expect(parsePhone("+1 (555) 123-4567", "US")).toEqual({ ok: true, e164: "+15551234567" });
    expect(parsePhone("15551234567", "US")).toEqual({ ok: true, e164: "+15551234567" });
  });

  it("strips a national trunk prefix outside NANP", () => {
    expect(parsePhone("020 7123 4567", "GB")).toEqual({ ok: true, e164: "+442071234567" });
  });

  // Pinned as current behaviour: NANP has no trunk prefix, so a leading zero
  // there is a real digit and is NOT stripped -- it just fails the length check
  // if that makes the number the wrong length.
  it("does not strip leading zeros for NANP", () => {
    expect(parsePhone("0555123456", "US")).toEqual({ ok: true, e164: "+10555123456" });
  });

  it("rejects an empty or digitless input", () => {
    expect(parsePhone("", "US")).toEqual({ ok: false, error: "Enter a phone number." });
    expect(parsePhone("abc", "US")).toEqual({ ok: false, error: "Enter a phone number." });
  });

  it("rejects an unknown country", () => {
    expect(parsePhone("5551234567", "ZZ")).toEqual({ ok: false, error: "Pick a country for the number." });
  });

  it("rejects NANP numbers that aren't exactly 10 digits", () => {
    expect(parsePhone("555123", "US")).toEqual({ ok: false, error: "A number here should be 10 digits." });
    expect(parsePhone("55512345678", "US")).toEqual({ ok: false, error: "A number here should be 10 digits." });
  });

  it("rejects numbers that are too short elsewhere", () => {
    expect(parsePhone("123", "GB")).toEqual({ ok: false, error: "That number looks too short." });
  });

  it("enforces E.164's 15-digit ceiling", () => {
    const result = parsePhone("1234567890123456", "GB");
    expect(result).toEqual({ ok: false, error: "That number looks too long." });
  });
});

describe("formatE164ForDisplay", () => {
  it("shows a NANP number the way it was typed", () => {
    expect(formatE164ForDisplay("+15551234567", "US")).toBe("+1 (555) 123-4567");
  });

  it("shows non-NANP numbers as dial code plus bare digits", () => {
    expect(formatE164ForDisplay("+442071234567", "GB")).toBe("+44 2071234567");
  });

  it("falls back to the raw E.164 when the country is missing or unknown", () => {
    expect(formatE164ForDisplay("+15551234567", null)).toBe("+15551234567");
    expect(formatE164ForDisplay("+15551234567", "ZZ")).toBe("+15551234567");
  });

  // Round-trip: what parsePhone stores should come back out looking like what
  // was typed. This is the property the two functions exist to jointly satisfy.
  it("round-trips with parsePhone", () => {
    const parsed = parsePhone("(555) 123-4567", "US");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(formatE164ForDisplay(parsed.e164, "US")).toBe("+1 (555) 123-4567");
    }
  });
});

describe("flagEmoji", () => {
  it("derives the flag from the ISO code", () => {
    expect(flagEmoji("US")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(flagEmoji("GB")).toBe("\u{1F1EC}\u{1F1E7}");
  });

  it("uppercases first, so a lowercase code still produces a flag", () => {
    expect(flagEmoji("us")).toBe(flagEmoji("US"));
  });
});
