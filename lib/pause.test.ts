import { describe, it, expect } from "vitest";
import { formatNameList, pausedInviteeMessage, PAUSED_TAG } from "./pause";

/**
 * Characterization tests pinning what this module does today -- see the note
 * at the top of phone.test.ts.
 *
 * Small, but the exact class of code worth pinning cheaply: list formatting
 * with pluralisation and a cap, where every boundary (0, 1, max, max+1) is a
 * separate branch and a refactor could plausibly shift one by one.
 */

describe("formatNameList", () => {
  it("returns an empty string for no names", () => {
    expect(formatNameList([])).toBe("");
  });

  it("returns the bare name for one", () => {
    expect(formatNameList(["Ari"])).toBe("Ari");
  });

  it("joins two with 'and', no comma", () => {
    expect(formatNameList(["Ari", "Sam"])).toBe("Ari and Sam");
  });

  it("uses commas plus a final 'and' for three", () => {
    // No Oxford comma -- pinned as current behaviour.
    expect(formatNameList(["Ari", "Sam", "Jo"])).toBe("Ari, Sam and Jo");
  });

  it("switches to an overflow count past the cap", () => {
    expect(formatNameList(["Ari", "Sam", "Jo", "Kit"])).toBe("Ari, Sam, Jo and 1 other");
  });

  it("pluralises the overflow count", () => {
    expect(formatNameList(["Ari", "Sam", "Jo", "Kit", "Lee"])).toBe("Ari, Sam, Jo and 2 others");
  });

  // The boundary itself: exactly `max` names must still read as a plain list,
  // not as an overflow with "and 0 others".
  it("treats exactly max as a plain list", () => {
    expect(formatNameList(["Ari", "Sam", "Jo"], 3)).toBe("Ari, Sam and Jo");
  });

  it("honours a custom cap", () => {
    expect(formatNameList(["Ari", "Sam", "Jo"], 2)).toBe("Ari, Sam and 1 other");
    expect(formatNameList(["Ari", "Sam"], 1)).toBe("Ari and 1 other");
  });
});

describe("pausedInviteeMessage", () => {
  it("uses singular verb and noun for one person", () => {
    expect(pausedInviteeMessage(["Ari"])).toBe(
      "Ari has paused their Venndra account, so they can't be added to a new event right now."
    );
  });

  it("uses plural verb and noun for several", () => {
    expect(pausedInviteeMessage(["Ari", "Sam"])).toBe(
      "Ari and Sam have paused their Venndra accounts, so they can't be added to a new event right now."
    );
  });

  it("caps the name list like formatNameList does", () => {
    expect(pausedInviteeMessage(["Ari", "Sam", "Jo", "Kit"])).toContain("Ari, Sam, Jo and 1 other");
  });

  // Says "right now" on purpose -- unpausing is one click, so the wording must
  // not imply the door is permanently closed. Pinned because it is a
  // deliberate copy decision, not an accident of phrasing.
  it("keeps the wording provisional", () => {
    expect(pausedInviteeMessage(["Ari"])).toContain("right now");
  });
});

describe("PAUSED_TAG", () => {
  it("is the label the UI greys people out with", () => {
    expect(PAUSED_TAG).toBe("Paused");
  });
});
