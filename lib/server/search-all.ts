import type { MedplumClient } from '@medplum/core';
import type { ResourceType, ExtractResource } from '@medplum/fhirtypes';

/**
 * Reads EVERY page of a Medplum search (follows Bundle `next` links via
 * searchResourcePages). `_count` is only a page size, never a cap.
 * Pass a URLSearchParams to repeat a key (repeated `identifier` = AND). Callers must still put the clinic identifier in `params` so the search itself is clinic-scoped.
 */
export async function searchAllPages<K extends ResourceType>(
  medplum: MedplumClient,
  type: K,
  params: Record<string, string> | URLSearchParams,
  pageSize = 100
): Promise<ExtractResource<K>[]> {
  const query = new URLSearchParams(params as any);
  query.set('_count', String(pageSize));
  const out: ExtractResource<K>[] = [];
  for await (const page of medplum.searchResourcePages(
    type,
    query,
    { cache: 'no-cache' }
  )) {
    out.push(...(page as ExtractResource<K>[]));
  }
  return out;
}
