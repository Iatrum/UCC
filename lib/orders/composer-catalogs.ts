import type { ClinicalCatalogItem, ClinicalCatalogType } from '@/lib/clinical-catalog';

export type ProcedureOption = {
  id: string; label: string; price?: number; codingSystem?: string; codingCode?: string; codingDisplay?: string;
};
export type MedicationOption = { id: string; name: string; unitPrice: number };
export type ComposerCatalogs = {
  procedures: ProcedureOption[];
  medications: MedicationOption[];
  labs: ClinicalCatalogItem[];
  imaging: ClinicalCatalogItem[];
  documents: ClinicalCatalogItem[];
};
export type ComposerCatalogLoaders = {
  getProcedures: () => Promise<{
    id: string; name: string; defaultPrice?: number; codingSystem?: string; codingCode?: string; codingDisplay?: string;
  }[]>;
  getMedications: () => Promise<{ id: string; name: string; unitPrice?: number }[]>;
  getClinicalCatalog: (type: ClinicalCatalogType) => Promise<ClinicalCatalogItem[]>;
};

export const emptyComposerCatalogs: ComposerCatalogs = {
  procedures: [], medications: [], labs: [], imaging: [], documents: [],
};

/** The order composer (treatment drawer) is the only consumer of these catalogs. */
export function shouldLoadComposerCatalogs(drawerMode: string, panelOpen: boolean, alreadyRequested: boolean) {
  return !alreadyRequested && panelOpen && drawerMode === 'treatment';
}

export async function loadComposerCatalogs(loaders: ComposerCatalogLoaders): Promise<ComposerCatalogs> {
  const [procedures, medications, labs, imaging, documents] = await Promise.all([
    loaders.getProcedures(),
    loaders.getMedications(),
    loaders.getClinicalCatalog('lab'),
    loaders.getClinicalCatalog('imaging'),
    loaders.getClinicalCatalog('document'),
  ]);
  return {
    procedures: procedures.map((p) => ({
      id: p.id, label: p.name, price: p.defaultPrice,
      codingSystem: p.codingSystem, codingCode: p.codingCode, codingDisplay: p.codingDisplay,
    })),
    medications: medications.map((m) => ({ id: m.id, name: m.name, unitPrice: m.unitPrice || 0 })),
    labs: labs.filter((i) => i.active),
    imaging: imaging.filter((i) => i.active),
    documents: documents.filter((i) => i.active),
  };
}

/**
 * Once-only loader for the treatment drawer: concurrent calls (fast open/close/open) share one request,
 * a success is never repeated, and a failure clears the latch so reopening the drawer retries
 * (otherwise one transient error would leave the composer with empty catalogs until a page reload).
 */
export function createComposerCatalogRequester(
  load: () => Promise<ComposerCatalogs>,
  onLoaded: (catalogs: ComposerCatalogs) => void,
  onError: (error: unknown) => void,
) {
  let state: 'idle' | 'loading' | 'done' = 'idle';
  return {
    requested: () => state !== 'idle',
    request() {
      if (state !== 'idle') return;
      state = 'loading';
      load().then(
        (catalogs) => { state = 'done'; onLoaded(catalogs); },
        (error) => { state = 'idle'; onError(error); },
      );
    },
  };
}
