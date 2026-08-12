/**
 * Phone numbers: the country list, one canonical storage spelling, and the
 * display formatting that never reaches the database.
 *
 * Shared by client and server on purpose -- no "use client", no imports of
 * anything Node-only -- because the field in /settings and the route that
 * saves it have to agree on what a valid number is. When they disagree, the
 * form either rejects something the API would have taken or (worse) accepts
 * something it won't, and the user gets an error with nothing to act on.
 *
 * Deliberately NOT libphonenumber-js. That library is the right answer for
 * per-country national-number rules -- it knows a UK mobile is 10 digits after
 * the 44 while a London landline is also 10 but a Guernsey number isn't -- and
 * it costs ~145kB in the client bundle to know it. This field doesn't need
 * that: it needs to store something matchable, and the cost of being slightly
 * too permissive is an unverifiable number that simply never receives its text
 * and stays pending forever. If contact matching later starts producing wrong
 * pairings from loose validation, that's the moment to buy the dependency.
 */

export type Country = {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  /** Country calling code, digits only, no plus. */
  dial: string;
  name: string;
};

/**
 * Not the full ISO list.
 *
 * A wrong dial code is a silent bug -- the number saves, the text goes
 * nowhere, and the user is left staring at "pending" with nothing to fix -- so
 * this is the set worth being confident about rather than an exhaustive table
 * padded out with guesses. Adding a country is one line, and the only thing
 * that makes it correct is checking the code against the ITU's list first.
 *
 * Sorted by name, which is also the order the dropdown renders.
 */
export const COUNTRIES: Country[] = [
  { iso: "AR", dial: "54", name: "Argentina" },
  { iso: "AU", dial: "61", name: "Australia" },
  { iso: "AT", dial: "43", name: "Austria" },
  { iso: "BD", dial: "880", name: "Bangladesh" },
  { iso: "BE", dial: "32", name: "Belgium" },
  { iso: "BR", dial: "55", name: "Brazil" },
  { iso: "BG", dial: "359", name: "Bulgaria" },
  { iso: "CA", dial: "1", name: "Canada" },
  { iso: "CL", dial: "56", name: "Chile" },
  { iso: "CN", dial: "86", name: "China" },
  { iso: "CO", dial: "57", name: "Colombia" },
  { iso: "CR", dial: "506", name: "Costa Rica" },
  { iso: "HR", dial: "385", name: "Croatia" },
  { iso: "CZ", dial: "420", name: "Czechia" },
  { iso: "DK", dial: "45", name: "Denmark" },
  { iso: "DO", dial: "1", name: "Dominican Republic" },
  { iso: "EC", dial: "593", name: "Ecuador" },
  { iso: "EG", dial: "20", name: "Egypt" },
  { iso: "EE", dial: "372", name: "Estonia" },
  { iso: "FI", dial: "358", name: "Finland" },
  { iso: "FR", dial: "33", name: "France" },
  { iso: "DE", dial: "49", name: "Germany" },
  { iso: "GH", dial: "233", name: "Ghana" },
  { iso: "GR", dial: "30", name: "Greece" },
  { iso: "HK", dial: "852", name: "Hong Kong" },
  { iso: "HU", dial: "36", name: "Hungary" },
  { iso: "IS", dial: "354", name: "Iceland" },
  { iso: "IN", dial: "91", name: "India" },
  { iso: "ID", dial: "62", name: "Indonesia" },
  { iso: "IE", dial: "353", name: "Ireland" },
  { iso: "IL", dial: "972", name: "Israel" },
  { iso: "IT", dial: "39", name: "Italy" },
  { iso: "JM", dial: "1", name: "Jamaica" },
  { iso: "JP", dial: "81", name: "Japan" },
  { iso: "KE", dial: "254", name: "Kenya" },
  { iso: "LV", dial: "371", name: "Latvia" },
  { iso: "LT", dial: "370", name: "Lithuania" },
  { iso: "LU", dial: "352", name: "Luxembourg" },
  { iso: "MY", dial: "60", name: "Malaysia" },
  { iso: "MT", dial: "356", name: "Malta" },
  { iso: "MX", dial: "52", name: "Mexico" },
  { iso: "MA", dial: "212", name: "Morocco" },
  { iso: "NL", dial: "31", name: "Netherlands" },
  { iso: "NZ", dial: "64", name: "New Zealand" },
  { iso: "NG", dial: "234", name: "Nigeria" },
  { iso: "NO", dial: "47", name: "Norway" },
  { iso: "PK", dial: "92", name: "Pakistan" },
  { iso: "PA", dial: "507", name: "Panama" },
  { iso: "PE", dial: "51", name: "Peru" },
  { iso: "PH", dial: "63", name: "Philippines" },
  { iso: "PL", dial: "48", name: "Poland" },
  { iso: "PT", dial: "351", name: "Portugal" },
  { iso: "PR", dial: "1", name: "Puerto Rico" },
  { iso: "RO", dial: "40", name: "Romania" },
  { iso: "SA", dial: "966", name: "Saudi Arabia" },
  { iso: "RS", dial: "381", name: "Serbia" },
  { iso: "SG", dial: "65", name: "Singapore" },
  { iso: "SK", dial: "421", name: "Slovakia" },
  { iso: "SI", dial: "386", name: "Slovenia" },
  { iso: "ZA", dial: "27", name: "South Africa" },
  { iso: "KR", dial: "82", name: "South Korea" },
  { iso: "ES", dial: "34", name: "Spain" },
  { iso: "LK", dial: "94", name: "Sri Lanka" },
  { iso: "SE", dial: "46", name: "Sweden" },
  { iso: "CH", dial: "41", name: "Switzerland" },
  { iso: "TW", dial: "886", name: "Taiwan" },
  { iso: "TH", dial: "66", name: "Thailand" },
  { iso: "TT", dial: "1", name: "Trinidad and Tobago" },
  { iso: "TR", dial: "90", name: "Türkiye" },
  { iso: "UA", dial: "380", name: "Ukraine" },
  { iso: "AE", dial: "971", name: "United Arab Emirates" },
  { iso: "GB", dial: "44", name: "United Kingdom" },
  { iso: "US", dial: "1", name: "United States" },
  { iso: "UY", dial: "598", name: "Uruguay" },
  { iso: "VN", dial: "84", name: "Vietnam" },
];

/** Matches the User.timezone default, and the majority of current users. */
export const DEFAULT_COUNTRY = "US";

export function findCountry(iso: string | null | undefined): Country | undefined {
  return COUNTRIES.find((c) => c.iso === iso);
}

/**
 * The flag, derived from the ISO code rather than stored.
 *
 * A country's flag emoji is its two letters written in Unicode's regional
 * indicator block, so there is nothing to maintain and nothing to get out of
 * sync with COUNTRIES -- adding a row gets its flag for free.
 *
 * Worth knowing: Windows has no flag glyphs in its emoji font, so Chrome and
 * Edge there would render these as the bare letters ("US", "GB"). The
 * `.font-flags` class in globals.css supplies the missing glyphs; anything
 * displaying a flag needs to carry it. Even without it the letters are a
 * legible fallback rather than tofu, which is why the dropdown also spells the
 * country name out.
 */
export function flagEmoji(iso: string): string {
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Every digit in the string, and nothing else. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * North American Numbering Plan -- the countries sharing +1, whose numbers are
 * always exactly 10 national digits and are the ones the field formats as it
 * types. Everywhere else varies too much to reformat mid-keystroke without
 * fighting the person entering the number.
 */
function isNanp(iso: string): boolean {
  return findCountry(iso)?.dial === "1";
}

/**
 * What the input box shows: "(555) 123-4567" for +1 countries, the raw digits
 * everywhere else.
 *
 * Formats progressively so it reads correctly while half-typed -- "(555) 12"
 * rather than nothing until the tenth digit -- and stops at 10 digits so
 * pasting a number with a country code on the front can't push the formatting
 * off the end.
 */
export function formatNational(digits: string, iso: string): string {
  if (!isNanp(iso)) return digits;

  const d = digits.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Pull the national digits back out of a stored E.164 number, so the field can
 * reopen showing what was typed rather than "+15551234567".
 *
 * Needs the country because the dial code can't be recovered from the number
 * alone: "+1..." is one digit of prefix and "+353..." is three, and guessing
 * by longest match would strip real leading digits from some national numbers.
 */
export function nationalDigits(e164: string, iso: string): string {
  const dial = findCountry(iso)?.dial;
  const digits = digitsOf(e164);
  if (dial && digits.startsWith(dial)) return digits.slice(dial.length);
  return digits;
}

export type ParsedPhone = { ok: true; e164: string } | { ok: false; error: string };

/**
 * The one place a country and some typed digits become a stored number.
 *
 * Both the form and POST /api/me/phone call this, so "is this savable" has a
 * single answer. The checks are deliberately shallow (see the note at the top
 * of the file): a plausible length, and E.164's hard 15-digit ceiling. The
 * real proof that a number is real is the text arriving at it.
 */
export function parsePhone(input: string, iso: string): ParsedPhone {
  const country = findCountry(iso);
  if (!country) return { ok: false, error: "Pick a country for the number." };

  let national = digitsOf(input);
  if (!national) return { ok: false, error: "Enter a phone number." };

  // A number typed or pasted with its own country code on the front. Dropping
  // the duplicate beats rejecting it: "+1 (555) 123-4567" pasted from a
  // contacts app is the single most likely thing to land in this box, and
  // prepending the dial code again would silently save a 14-digit number that
  // can never receive anything.
  if (national.length > (isNanp(iso) ? 10 : country.dial.length) && national.startsWith(country.dial)) {
    national = national.slice(country.dial.length);
  }

  // Several countries write a trunk prefix -- a leading 0 -- in national form
  // that is dropped in the international one. Keeping it produces a number
  // that looks right on paper and is undeliverable. NANP has no trunk prefix,
  // so this only applies elsewhere.
  if (!isNanp(iso)) national = national.replace(/^0+/, "");

  if (isNanp(iso)) {
    if (national.length !== 10) return { ok: false, error: "A number here should be 10 digits." };
  } else if (national.length < 4) {
    return { ok: false, error: "That number looks too short." };
  }

  const e164 = `+${country.dial}${national}`;
  // E.164 caps the whole thing, country code included, at 15 digits. Nothing
  // longer is a phone number anywhere on earth.
  if (digitsOf(e164).length > 15) return { ok: false, error: "That number looks too long." };

  return { ok: true, e164 };
}

/**
 * How a saved number is shown back to the user -- in confirmations, and in the
 * text message itself, so what they read matches what they typed.
 */
export function formatE164ForDisplay(e164: string, iso: string | null | undefined): string {
  const country = iso ? findCountry(iso) : undefined;
  if (!country) return e164;
  return `+${country.dial} ${formatNational(nationalDigits(e164, country.iso), country.iso)}`;
}
