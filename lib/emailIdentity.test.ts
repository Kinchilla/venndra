import { describe, it, expect } from "vitest";
import { normalizeEmail, emailField, emailListField } from "./emailIdentity";

/**
 * Characterization tests pinning what this module does today -- see the note
 * at the top of phone.test.ts.
 *
 * This is the one module #42 covers that maps directly onto a documented #30
 * instance (email normalisation, #25). It is also load-bearing well beyond
 * that: auth, friend lookup, and the rate-limit erasure in account deletion
 * all assume normalisation is exact, and none of them would fail loudly if it
 * quietly stopped being so -- a friend request would just not find somebody
 * who exists.
 */

describe("normalizeEmail", () => {
  it("lowercases", () => {
    expect(normalizeEmail("Friend@Gmail.com")).toBe("friend@gmail.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  friend@gmail.com  ")).toBe("friend@gmail.com");
  });

  it("does both at once", () => {
    expect(normalizeEmail("  Friend@GMAIL.COM ")).toBe("friend@gmail.com");
  });

  it("is idempotent -- applying it twice changes nothing", () => {
    const once = normalizeEmail("  Friend@Gmail.com ");
    expect(normalizeEmail(once)).toBe(once);
  });

  // Pinned, not endorsed: normalisation is only case and whitespace. It does
  // NOT strip Gmail dots or +tags, so these remain distinct strings. That is
  // the correct call -- they are genuinely different addresses at some
  // providers -- but it is an assumption worth having written down.
  it("does not touch plus-tags or dots", () => {
    expect(normalizeEmail("a.b+tag@gmail.com")).toBe("a.b+tag@gmail.com");
  });
});

describe("emailField", () => {
  it("accepts and normalises a valid address", () => {
    expect(emailField.parse("Friend@Gmail.com")).toBe("friend@gmail.com");
  });

  it("accepts an address pasted with trailing whitespace", () => {
    // .trim() runs before .email() precisely so this validates rather than
    // being rejected as malformed.
    expect(emailField.parse("friend@gmail.com  ")).toBe("friend@gmail.com");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "not-an-email", "no@tld", "@nolocal.com", "two@@at.com"]) {
      expect(emailField.safeParse(bad).success).toBe(false);
    }
  });

  // The specific bug from #25: an address typed the way it appears in someone's
  // signature used to miss a user who plainly existed.
  it("makes differently-cased spellings of one address converge", () => {
    expect(emailField.parse("Friend@Gmail.com")).toBe(emailField.parse("friend@gmail.com"));
  });
});

describe("emailListField", () => {
  it("normalises every entry", () => {
    expect(emailListField.parse(["A@x.com", " b@X.com "])).toEqual(["a@x.com", "b@x.com"]);
  });

  it("collapses duplicates that only differed by spelling", () => {
    // Not tidiness: validateAllFriends compares the row count it found against
    // the address count it was given, so a duplicate makes those disagree.
    expect(emailListField.parse(["Friend@x.com", "friend@x.com"])).toEqual(["friend@x.com"]);
  });

  it("preserves order, keeping the first occurrence", () => {
    expect(emailListField.parse(["b@x.com", "a@x.com", "B@x.com"])).toEqual(["b@x.com", "a@x.com"]);
  });

  it("requires at least one address", () => {
    expect(emailListField.safeParse([]).success).toBe(false);
  });

  it("rejects the list if any single entry is malformed", () => {
    expect(emailListField.safeParse(["ok@x.com", "nope"]).success).toBe(false);
  });

  // Pinned deliberately: min/max apply to the RAW list, before de-duplication.
  // 50 is a ceiling on what may be submitted, not on what survives -- so 51
  // entries fail even if they collapse to one distinct address.
  it("applies the 50 cap before collapsing, not after", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `user${i}@x.com`);
    expect(emailListField.safeParse(fifty).success).toBe(true);

    const fiftyOneIdentical = Array.from({ length: 51 }, () => "same@x.com");
    expect(emailListField.safeParse(fiftyOneIdentical).success).toBe(false);
  });
});
