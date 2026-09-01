import { z } from "zod";
import { emailListField } from "./emailIdentity";
import { weeklyHoursSchema } from "./searchWindowSchema";

/**
 * The body of a saved-group write, declared once (#30).
 *
 * POST /api/groups and PATCH /api/groups/[id] accept exactly the same body,
 * and until now each declared it separately -- two byte-identical copies in
 * sibling files. Nothing made them agree, so adding a field to one would have
 * left create and update quietly accepting different shapes of the same thing.
 */
export const savedGroupSchema = z.object({
  name: z.string().min(1).max(60),
  // Normalised and de-duplicated -- see lib/emailIdentity.
  emails: emailListField,
  // Nullable, not just optional: null is how the client says "this group
  // has no search window", which has to be distinguishable from the field
  // simply being absent.
  defaultFilters: weeklyHoursSchema.nullable().optional(),
});
