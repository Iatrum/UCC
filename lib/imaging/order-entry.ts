/**
 * Where imaging can be ordered from the patient Labs & Imaging route.
 *
 * With the X-ray (pacs) module on, the only order path is the Treatment panel
 * (composer X-ray section + Sign), which mints the accession number that incoming
 * DICOM is matched against. The stand-alone catalog form posts orders without an
 * accession, so it is hidden whenever the module is on. With the module off it stays
 * as the generic, module-independent imaging order form.
 */
export type ImagingOrderEntryMode = 'treatment-panel-only' | 'generic-form';

export function imagingOrderEntryMode(pacsEnabled: boolean): ImagingOrderEntryMode {
  return pacsEnabled ? 'treatment-panel-only' : 'generic-form';
}

/**
 * Resolve the mode from a (possibly failing) module lookup. Fails CLOSED: if the lookup
 * throws or rejects we cannot tell whether X-ray is on, so we show the Treatment-panel
 * pointer rather than the accession-less generic form.
 */
export async function resolveImagingOrderEntryMode(
  lookupPacsEnabled: () => Promise<boolean>
): Promise<ImagingOrderEntryMode> {
  try {
    return imagingOrderEntryMode(await lookupPacsEnabled());
  } catch {
    return 'treatment-panel-only';
  }
}
