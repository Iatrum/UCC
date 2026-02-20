import { NextRequest } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { ocrBodySchema } from "@/lib/validation";
import { recognizeIC } from "@/lib/ocr";
import { AUTH_DISABLED } from "@/lib/auth-config";
import { requireAuth } from "@/lib/server/medplum-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (!AUTH_DISABLED) {
      try {
        await requireAuth(req);
      } catch {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(`ocr:${ip}`, 12, 60_000)) {
      return new Response(JSON.stringify({ error: "Too Many Requests" }), { status: 429 });
    }
    const parsed = ocrBodySchema.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400 });
    const { image } = parsed.data;
    const payload = await recognizeIC(image);

    return new Response(
      JSON.stringify(payload),
      { status: 200 }
    );
  } catch (e: any) {
    console.error("OCR error", e);
    const message = e?.message === "OCR timed out" ? e.message : "Unexpected error";
    const status = e?.message === "OCR timed out" ? 504 : 500;
    return new Response(JSON.stringify({ error: message }), { status });
  }
}
