/**
 * Status for the billing Procedure written at consultation Sign.
 *
 * Lab/Imaging lines are *orders*, not performed work. FHIR R4 Procedure.status "completed" means
 * "the procedure has been completed", so writing it at Sign (before the study/test is done) is wrong.
 * "preparation" is the R4 code for "not yet started". Everything else (consultation fee, services,
 * documents, MC...) is performed at Sign and stays "completed".
 *
 * Checkout totals are unaffected: billing lines are read from the order price/quantity extensions and
 * code.text, never from Procedure.status.
 */
export type OrderProcedureStatus = 'completed' | 'preparation';

const ORDERED_INVESTIGATION_NAME = /^\s*(Lab|Imaging):/i;

export function orderProcedureStatus(proc: { name?: string }): OrderProcedureStatus {
  return ORDERED_INVESTIGATION_NAME.test(proc.name || '') ? 'preparation' : 'completed';
}
