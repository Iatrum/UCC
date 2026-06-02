import { NextRequest, NextResponse } from 'next/server';
import { getClinicalCatalogItems } from '@/lib/fhir/catalog-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

function scoreDiagnosis(item: { name: string; display?: string; code?: string; category?: string }, query: string): number {
  if (!query) return 1;
  const fields = [item.name, item.display, item.code, item.category].filter(Boolean).map((value) => String(value).toLowerCase());
  let score = 0;
  if (item.name.toLowerCase().includes(`(${query})`)) score = Math.max(score, 95);
  for (const field of fields) {
    if (field === query) score = Math.max(score, 100);
    if (field.startsWith(query)) score = Math.max(score, 75);
    if (field.includes(query)) score = Math.max(score, 50);
  }
  return score;
}

function toDiagnosisOption(item: Awaited<ReturnType<typeof getClinicalCatalogItems>>[number]) {
  const coding = item.system && item.code
    ? item.system.includes('snomed')
      ? { snomed: { code: item.code, display: item.display || item.name } }
      : { icd10: { code: item.code, display: item.display || item.name } }
    : {};

  return {
    key: item.id,
    text: item.name,
    ...coding,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').trim().toLowerCase();
    const limitParam = Number(searchParams.get('limit') || '12');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 25) : 12;

    const items = await getClinicalCatalogItems(medplum, clinicId, 'diagnosis');
    const diagnoses = items
      .filter((item) => item.active)
      .map((item) => ({ item, score: scoreDiagnosis(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
      .slice(0, limit)
      .map(({ item }) => toDiagnosisOption(item));

    return NextResponse.json({ success: true, diagnoses });
  } catch (error: any) {
    return handleRouteError(error, 'GET /api/diagnoses');
  }
}
