/**
 * X-ray accession numbers (X-ray phase 3). Pure: no Next/Medplum imports.
 *
 * The accession number is the only join key between a DICOM study and its order: UCC puts it on the
 * X-ray ServiceRequest, the radiographer (or a modality worklist) puts it on the study, and the PACS
 * ingress matches the two inside ONE clinic. DICOM AccessionNumber is VR SH: at most 16 characters.
 */
import { randomInt } from 'node:crypto';

export const XRAY_ACCESSION_SYSTEM = 'https://ucc.emr/xray/accession';
/** FHIR R4 ImagingStudy: the DICOM Study Instance UID is an identifier `urn:dicom:uid` / `urn:oid:<uid>`. */
export const DICOM_UID_SYSTEM = 'urn:dicom:uid';

// No 0/O/1/I/L: the number may be typed by hand on a modality console.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ACCESSION = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;

/** `UX` + 12 random characters (about 59 bits): 14 characters, fits VR SH. */
export function generateAccessionNumber(): string {
  let out = 'UX';
  for (let i = 0; i < 12; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Trimmed, upper-cased accession number, or undefined when it is empty or not a plain SH token. */
export function normalizeAccessionNumber(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.trim().toUpperCase();
  return ACCESSION.test(value) ? value : undefined;
}

type Identified = { identifier?: { system?: string; value?: string }[] };

export function readAccessionNumber(resource: Identified): string | undefined {
  return normalizeAccessionNumber(resource.identifier?.find((id) => id.system === XRAY_ACCESSION_SYSTEM)?.value);
}

export function readStudyUid(resource: Identified): string | undefined {
  const value = resource.identifier?.find((id) => id.system === DICOM_UID_SYSTEM)?.value;
  return value?.startsWith('urn:oid:') ? value.slice('urn:oid:'.length) : undefined;
}
