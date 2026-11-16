import type { Extension, ImagingStudy } from '@medplum/fhirtypes';

export const PACS_VIEWER_URL_EXTENSION = 'https://ucc.emr/xray/viewer-url';
const XRAY_TAG_SYSTEM = 'https://ucc.emr/xray';
const MAX_URL_LENGTH = 2048;

/**
 * A PACS viewer link is device-supplied and rendered as a clickable link, so only
 * absolute http(s) URLs without embedded credentials are accepted (blocks javascript:,
 * data:, file: and user:pass@ URLs). Returns the normalised URL or undefined.
 */
export function sanitizePacsViewerUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input.trim() || input.length > MAX_URL_LENGTH) return undefined;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function pacsViewerUrlExtension(input: unknown): Extension[] | undefined {
  const url = sanitizePacsViewerUrl(input);
  return url ? [{ url: PACS_VIEWER_URL_EXTENSION, valueUrl: url }] : undefined;
}

export function readPacsViewerUrl(study: ImagingStudy): string | undefined {
  return sanitizePacsViewerUrl(study.extension?.find((e) => e.url === PACS_VIEWER_URL_EXTENSION)?.valueUrl);
}

/** Set only by the server-side Orthanc ingress: the study's pixels are held by the clinic PACS. */
export const PACS_STORED_TAG = { system: 'https://ucc.emr/pacs', code: 'orthanc' } as const;

export function isPacsStoredStudy(study: ImagingStudy): boolean {
  return Boolean(study.meta?.tag?.some((t) => t.system === PACS_STORED_TAG.system && t.code === PACS_STORED_TAG.code));
}

export function isXrayStudy(study: ImagingStudy): boolean {
  return Boolean(study.meta?.tag?.some((t) => t.system === XRAY_TAG_SYSTEM && t.code === 'xray'));
}

/**
 * Clinic toggle gate for the results view: with `pacs` off, X-ray studies and their
 * viewer links are hidden entirely; generic imaging orders are unaffected.
 */
export function gateXrayStudies<T extends { xray?: boolean }>(studies: T[], pacsEnabled: boolean): T[] {
  return pacsEnabled ? studies : studies.filter((s) => !s.xray);
}

/** DICOM modalities treated as plain X-ray for the viewer link (CT/MR/US etc. never get it). */
export const XRAY_MODALITIES = ['DX', 'CR', 'RG'] as const;

export function isXrayModality(modality: unknown): boolean {
  return typeof modality === 'string' && (XRAY_MODALITIES as readonly string[]).includes(modality.toUpperCase());
}
