import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

// Same shape as Event.filters / SavedGroup.defaultFilters -- day-key ->
// array of [start, end] time-of-day windows. `null` is a meaningful,
// explicit value here (not just "field omitted") -- it's how the Settings
// page's "Reset to app default" button clears a previously saved default.
const weeklyHoursSchema = z.record(z.array(z.tuple([z.string(), z.string()])));

const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  timezone: z.string().min(1).optional(),
  defaultSearchFilters: weeklyHoursSchema.nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Prisma's Json? fields treat a plain JS `null` as ambiguous -- it can't
  // tell "clear this field" apart from "field wasn't sent at all" the same
  // way it can for ordinary nullable columns. Prisma.JsonNull is the
  // required sentinel for an explicit "set this JSON column to NULL" --
  // needed here since "Reset to app default" sends defaultSearchFilters:
  // null on purpose, not just omits it.
  const { defaultSearchFilters, ...rest } = parsed.data;
  const user = await prisma.user.update({
    where: { id: (session.user as any).id },
    data: {
      ...rest,
      ...(defaultSearchFilters !== undefined && {
        defaultSearchFilters: defaultSearchFilters === null ? Prisma.JsonNull : defaultSearchFilters,
      }),
    },
  });

  return NextResponse.json({
    user: {
      name: user.name,
      timezone: user.timezone,
      image: user.image,
      defaultSearchFilters: user.defaultSearchFilters,
    },
  });
}
