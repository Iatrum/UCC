import { NextRequest, NextResponse } from 'next/server';
import {
  createClinicalCatalogItem,
  deleteClinicalCatalogItem,
  getClinicalCatalogItems,
  updateClinicalCatalogItem,
  type ClinicalCatalogType,
} from '@/lib/fhir/catalog-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

function parseType(value: string | null): ClinicalCatalogType | undefined {
  if (value === 'lab' || value === 'imaging' || value === 'document') return value;
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const type = parseType(searchParams.get('type'));
    const items = await getClinicalCatalogItems(medplum, clinicId, type);
    return NextResponse.json({ success: true, items, count: items.length });
  } catch (error) {
    return handleRouteError(error, 'GET /api/catalogs');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const data = await request.json();
    const type = parseType(data?.type);

    if (!type || !data?.name) {
      return NextResponse.json({ success: false, error: 'type and name are required' }, { status: 400 });
    }

    const id = await createClinicalCatalogItem(medplum, clinicId, {
      type,
      name: data.name,
      code: data.code,
      system: data.system,
      display: data.display,
      category: data.category,
      modality: data.modality,
      defaultPrice: Number(data.defaultPrice || 0),
      active: data.active !== false,
      notes: data.notes,
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return handleRouteError(error, 'POST /api/catalogs');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { medplum } = await requireClinicAuth(request);
    const { id, ...updates } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    await updateClinicalCatalogItem(medplum, id, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/catalogs');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { medplum } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    await deleteClinicalCatalogItem(medplum, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/catalogs');
  }
}
