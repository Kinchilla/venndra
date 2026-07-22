import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length === 0) return NextResponse.json({ emails: [] });

  const matches = await prisma.knownContact.findMany({
    where: {
      userId: (session.user as any).id,
      email: { startsWith: query, mode: "insensitive" },
    },
    orderBy: { email: "asc" },
    take: 8,
    select: { email: true },
  });

  return NextResponse.json({ emails: matches.map((m) => m.email) });
}
