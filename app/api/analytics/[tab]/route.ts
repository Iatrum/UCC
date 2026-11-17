/**
 * Analytics tab data (Task 551). Auth + clinic scope + module gate; bounded queries, cached briefly per clinic.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import { isModuleEnabledForClinic } from "@/lib/module-registry";
import { getTabData, TAB_KEYS, type TabKey } from "@/lib/analytics/queries";
import { parseRange } from "@/lib/analytics/range";

export async function GET(req: NextRequest, ctx: { params: Promise<{ tab: string }> }) {
  try {
    const { tab } = await ctx.params;
    if (!TAB_KEYS.includes(tab as TabKey)) return NextResponse.json({ error: "Unknown tab" }, { status: 404 });
    const { medplum, clinicId } = await requireClinicAuth(req);
    if (!(await isModuleEnabledForClinic("analytics", clinicId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const range = parseRange(req.nextUrl.searchParams.get("range"));
    const data = await getTabData(tab as TabKey, medplum, clinicId, range);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    return handleRouteError(error, "analytics");
  }
}
