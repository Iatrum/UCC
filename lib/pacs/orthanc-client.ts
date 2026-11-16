/**
 * Server-side client for the clinic PACS (Orthanc) - X-ray phase 3. Server-only.
 *
 * Orthanc credentials live only in server env and never reach a browser: the viewer talks to UCC's
 * study-scoped DICOMweb proxy, and UCC talks to Orthanc. Everything is off (503) until all of
 * PACS_ORTHANC_URL / PACS_ORTHANC_USER / PACS_ORTHANC_PASSWORD / PACS_VIEWER_ORIGIN / PACS_VIEWER_SECRET
 * are set; see .ai/PLAN-xray-phase3.md.
 */
import { isDicomUid } from './viewer-token';

export interface PacsConfig {
  orthancUrl: string;
  authorization: string;
  /** Browser-facing origin of the OHIF viewer, e.g. https://viewer.clinic.example (no trailing slash). */
  viewerOrigin: string;
  viewerHost: string;
  viewerSecure: boolean;
  viewerSecret: string;
  /** Optional allowlist of clinic ids that may use this Orthanc (empty = any clinic with the module on). */
  clinics: string[];
}

export class PacsNotConfiguredError extends Error {
  constructor() { super('PACS storage is not configured'); this.name = 'PacsNotConfiguredError'; }
}
export class PacsUpstreamError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'PacsUpstreamError'; }
}

function httpOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function getPacsConfig(env: Record<string, string | undefined> = process.env): PacsConfig | undefined {
  const orthanc = httpOrigin(env.PACS_ORTHANC_URL);
  const viewer = httpOrigin(env.PACS_VIEWER_ORIGIN);
  const user = env.PACS_ORTHANC_USER;
  const password = env.PACS_ORTHANC_PASSWORD;
  const secret = env.PACS_VIEWER_SECRET;
  if (!orthanc || !viewer || !user || !password || !secret || secret.length < 32) return undefined;
  return {
    orthancUrl: orthanc.origin,
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    viewerOrigin: viewer.origin,
    viewerHost: viewer.host,
    viewerSecure: viewer.protocol === 'https:',
    viewerSecret: secret,
    clinics: (env.PACS_ORTHANC_CLINICS || '').split(',').map((c) => c.trim()).filter(Boolean),
  };
}

export function requirePacsConfig(): PacsConfig {
  const config = getPacsConfig();
  if (!config) throw new PacsNotConfiguredError();
  return config;
}

/** True when this Orthanc may hold studies of `clinicId` (see PACS_ORTHANC_CLINICS). */
export function pacsServesClinic(config: PacsConfig, clinicId: string): boolean {
  return !config.clinics.length || config.clinics.includes(clinicId);
}

export interface OrthancSeries {
  uid: string;
  number: number;
  modality: string;
  description?: string;
  bodySite?: string;
  numberOfInstances: number;
}

export interface OrthancStudy {
  orthancStudyId: string;
  studyUid: string;
  accessionNumber?: string;
  description?: string;
  started?: Date;
  /** DICOM PatientID / PatientName as sent by the modality: shown to staff in the review list only. */
  dicomPatientId?: string;
  dicomPatientName?: string;
  modality: string;
  numberOfInstances: number;
  series: OrthancSeries[];
}

/** Orthanc resource ids are SHA-1 based: five dash-separated groups of eight hex digits. */
const ORTHANC_ID = /^[0-9a-f]{8}(-[0-9a-f]{8}){4}$/;
export function isOrthancId(value: unknown): value is string {
  return typeof value === 'string' && ORTHANC_ID.test(value);
}

const text = (value: unknown, max = 128): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/** DICOM DA (YYYYMMDD) + TM (HHMMSS[.ffffff]) to a Date; the modality's wall clock is taken as UTC-less local. */
export function parseDicomDateTime(date: unknown, time: unknown): Date | undefined {
  const d = typeof date === 'string' ? date.trim() : '';
  if (!/^\d{8}$/.test(d)) return undefined;
  const t = typeof time === 'string' && /^\d{6}/.test(time.trim()) ? time.trim() : '000000';
  const parsed = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function orthancJson(config: PacsConfig, path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${config.orthancUrl}${path}`, {
      headers: { Authorization: config.authorization, Accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PacsUpstreamError('PACS storage is unreachable');
  }
  if (!response.ok) throw new PacsUpstreamError(`PACS storage answered ${response.status}`, response.status);
  return response.json();
}

/** Map Orthanc's `/studies/{id}` + `/studies/{id}/series` JSON to the fields UCC keeps. Exported for tests. */
export function mapOrthancStudy(orthancStudyId: string, study: any, seriesList: any[]): OrthancStudy | undefined {
  const tags = study?.MainDicomTags ?? {};
  if (!isDicomUid(tags.StudyInstanceUID)) return undefined;
  const series: OrthancSeries[] = [];
  for (const item of Array.isArray(seriesList) ? seriesList : []) {
    const st = item?.MainDicomTags ?? {};
    if (!isDicomUid(st.SeriesInstanceUID)) continue;
    const number = Number.parseInt(st.SeriesNumber, 10);
    series.push({
      uid: st.SeriesInstanceUID,
      number: Number.isFinite(number) ? number : series.length + 1,
      modality: text(st.Modality, 16)?.toUpperCase() || 'OT',
      description: text(st.SeriesDescription),
      bodySite: text(st.BodyPartExamined, 64),
      numberOfInstances: Array.isArray(item.Instances) ? item.Instances.length : 0,
    });
  }
  const patient = study?.PatientMainDicomTags ?? {};
  return {
    orthancStudyId,
    studyUid: tags.StudyInstanceUID,
    accessionNumber: text(tags.AccessionNumber, 64),
    description: text(tags.StudyDescription),
    started: parseDicomDateTime(tags.StudyDate, tags.StudyTime),
    dicomPatientId: text(patient.PatientID, 64),
    dicomPatientName: text(patient.PatientName, 64),
    modality: series[0]?.modality || 'OT',
    numberOfInstances: series.reduce((sum, s) => sum + s.numberOfInstances, 0),
    series,
  };
}

/** Read a study from Orthanc itself: the webhook payload is only a pointer and is never trusted for content. */
export async function fetchOrthancStudy(config: PacsConfig, orthancStudyId: string): Promise<OrthancStudy | undefined> {
  if (!isOrthancId(orthancStudyId)) return undefined;
  let study: any;
  try {
    study = await orthancJson(config, `/studies/${orthancStudyId}`);
  } catch (error) {
    if (error instanceof PacsUpstreamError && error.status === 404) return undefined;
    throw error;
  }
  const series = await orthancJson(config, `/studies/${orthancStudyId}/series`);
  return mapOrthancStudy(orthancStudyId, study, series);
}

/**
 * Read-only DICOMweb request to Orthanc for the viewer proxy. `scopedPath` MUST come from
 * scopeDicomwebRequest (already restricted to one study). The Forwarded header makes Orthanc build
 * any URL it returns (BulkDataURI) on the viewer origin instead of its own loopback address.
 */
export async function fetchDicomweb(config: PacsConfig, scopedPath: string, accept: string | null): Promise<Response> {
  try {
    return await fetch(`${config.orthancUrl}/dicom-web/${scopedPath}`, {
      headers: {
        Authorization: config.authorization,
        ...(accept ? { Accept: accept } : {}),
        Forwarded: `host=${config.viewerHost};proto=${config.viewerSecure ? 'https' : 'http'}`,
      },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new PacsUpstreamError('PACS storage is unreachable');
  }
}
