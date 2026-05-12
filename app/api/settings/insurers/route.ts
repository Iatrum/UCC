import { NextRequest, NextResponse } from "next/server";
import type { Basic } from "@medplum/fhirtypes";
import { requireClinicAuth } from "@/lib/server/medplum-auth";
import { handleRouteError } from "@/lib/server/route-helpers";
import type { Insurer } from "@/lib/insurers";

const CODE_SYSTEM = "urn:iatrum:resource-type";
const CODE_VALUE = "settings-insurer";
const CLINIC_SYSTEM = "clinic";
const DATA_EXT = "urn:iatrum:settings/insurer";

function toBasic(data: Omit<Insurer, "id">, clinicId: string): Basic {
  return {
    resourceType: "Basic",
    code: { coding: [{ system: CODE_SYSTEM, code: CODE_VALUE }] },
    identifier: [{ system: CLINIC_SYSTEM, value: clinicId }],
    extension: [{ url: DATA_EXT, valueString: JSON.stringify(data) }],
  };
}

function fromBasic(resource: Basic): Insurer {
  const raw = resource.extension?.find((extension) => extension.url === DATA_EXT)?.valueString;
  if (!raw) throw new Error("Malformed insurer settings resource");
  return { ...JSON.parse(raw), id: resource.id };
}

function belongsToClinic(resource: Basic, clinicId: string): boolean {
  return Boolean(resource.identifier?.some((id) => id.system === CLINIC_SYSTEM && id.value === clinicId));
}

function validateInsurer(input: any): string | null {
  if (!input || typeof input !== "object") return "Invalid JSON body";
  if (!String(input.name ?? "").trim()) return "Name is required.";
  if (!String(input.value ?? "").trim()) return "Value is required.";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const resources = await medplum.searchResources("Basic", {
      code: `${CODE_SYSTEM}|${CODE_VALUE}`,
      _count: "500",
      _sort: "_lastUpdated",
    });
    const insurers = (resources ?? [])
      .filter((resource) => belongsToClinic(resource, clinicId))
      .map(fromBasic)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, insurers });
  } catch (error) {
    return handleRouteError(error, "GET /api/settings/insurers");
  }
}

export async function POST(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const body = await req.json().catch(() => null);
    const validationError = validateInsurer(body);
    if (validationError) {
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }

    const now = new Date().toISOString();
    const created = await medplum.createResource(
      toBasic(
        {
          name: String(body.name).trim(),
          value: String(body.value).trim(),
          createdAt: now,
          updatedAt: now,
        },
        clinicId
      )
    );

    return NextResponse.json({ success: true, insurer: fromBasic(created) });
  } catch (error) {
    return handleRouteError(error, "POST /api/settings/insurers");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const body = await req.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const existing = (await medplum.readResource("Basic", body.id)) as Basic;
    if (!belongsToClinic(existing, clinicId)) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const current = fromBasic(existing);
    const next = {
      ...current,
      name: String(body.name ?? current.name).trim(),
      value: String(body.value ?? current.value).trim(),
      updatedAt: new Date().toISOString(),
    };
    const validationError = validateInsurer(next);
    if (validationError) {
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }

    const saved = await medplum.updateResource({ ...toBasic(next, clinicId), id: body.id });
    return NextResponse.json({ success: true, insurer: fromBasic(saved) });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/settings/insurers");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const existing = (await medplum.readResource("Basic", id)) as Basic;
    if (!belongsToClinic(existing, clinicId)) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    await medplum.deleteResource("Basic", id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/settings/insurers");
  }
}
