/**
 * POCT result bot — translates a raw analyser message (HL7 ORU^R01 or ASTM
 * E1394 result) into the existing FHIR Observation/DiagnosticReport pipeline.
 *
 * Written in the Medplum `Bot` handler shape (`handler(medplum, event)`,
 * same input content types Medplum documents for Bots: `text/plain` and
 * `x-application/hl7-v2+er7`) so it is a drop-in `Bot` resource once this
 * Medplum instance has `vmContextBotsEnabled` turned on (it currently does
 * not — see .ai/progress-task10.md). For now `ingestAnalyserMessage` is
 * called in-process by `/api/labs/receive/message`.
 */

import type { MedplumClient } from '@medplum/core';
import type { ServiceRequest } from '@medplum/fhirtypes';
import { parseOruMessage, oruToLabResults } from './hl7';
import { parseAstmResult, astmToLabResults } from './astm';
import { receiveLabResults, type LabResult } from '@/lib/fhir/lab-service';
import { POCT_TAG_SYSTEM } from '@/lib/fhir/poct-device';

export type AnalyserMessageFormat = 'hl7' | 'astm';

export interface AnalyserMessage {
  format: AnalyserMessageFormat;
  message: string;
}

export interface IngestResult {
  serviceRequestId: string;
  diagnosticReportId: string;
}

function isPoctServiceRequest(sr: ServiceRequest): boolean {
  return sr.meta?.tag?.some((t) => t.system === POCT_TAG_SYSTEM && t.code === 'poct') ?? false;
}

function parseAnalyserMessage(input: AnalyserMessage): { serviceRequestId: string; results: LabResult[] } {
  if (input.format === 'hl7') {
    const oru = parseOruMessage(input.message);
    return { serviceRequestId: oru.placerOrderNumber, results: oruToLabResults(oru.results) };
  }
  if (input.format === 'astm') {
    const astm = parseAstmResult(input.message);
    return { serviceRequestId: astm.placerOrderNumber, results: astmToLabResults(astm.results) };
  }
  throw new Error(`Unsupported analyser message format: ${input.format}`);
}

/**
 * Parse an analyser message and write it into FHIR via the same path
 * `/api/labs/receive` uses for JSON results. Only acts on ServiceRequests
 * tagged `poct` (this path is the POCT analyser bridge, not a general lab
 * results receiver — that's `/api/labs/receive`).
 */
export async function ingestAnalyserMessage(input: AnalyserMessage, medplum: MedplumClient): Promise<IngestResult> {
  const { serviceRequestId, results } = parseAnalyserMessage(input);
  if (results.length === 0) throw new Error('Analyser message contained no results');

  const serviceRequest = await medplum.readResource('ServiceRequest', serviceRequestId);
  if (!isPoctServiceRequest(serviceRequest)) {
    throw new Error(`ServiceRequest/${serviceRequestId} is not a POCT order`);
  }

  const diagnosticReportId = await receiveLabResults(serviceRequestId, results, undefined, medplum);
  return { serviceRequestId, diagnosticReportId };
}

/** Medplum Bot handler shape — not wired to a live Bot resource yet, kept deploy-ready. */
export async function handler(medplum: MedplumClient, event: { input: string; contentType?: string }): Promise<IngestResult> {
  const format: AnalyserMessageFormat = event.contentType === 'x-application/hl7-v2+er7' ? 'hl7' : 'astm';
  return ingestAnalyserMessage({ format, message: event.input }, medplum);
}
