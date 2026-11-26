import { getAllPatients, type Patient } from "@/lib/fhir/patient-client";
import { getAllPractitioners, type PractitionerOption } from "@/lib/fhir/practitioner-client";

export interface AppointmentLookup<T> {
  options: T[];
  error: string | null;
}

export function loadAppointmentLookups(
  onPatients: (result: AppointmentLookup<Patient>) => void,
  onClinicians: (result: AppointmentLookup<PractitionerOption>) => void,
): () => void {
  let cancelled = false;

  async function load<T>(
    fetchOptions: () => Promise<T[]>,
    name: (option: T) => string,
    label: string,
    onResult: (result: AppointmentLookup<T>) => void,
  ) {
    let result: AppointmentLookup<T>;
    try {
      const options = await fetchOptions();
      result = { options: options.slice().sort((a, b) => name(a).localeCompare(name(b))), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      const hint = message.includes("Authentication required") ? " Try refreshing the page." : "";
      result = { options: [], error: `Unable to load ${label}. ${message}${hint}` };
    }
    if (!cancelled) onResult(result);
  }

  void load(() => getAllPatients(200), (patient) => patient.fullName, "patients", onPatients);
  void load(getAllPractitioners, (practitioner) => practitioner.name, "clinicians", onClinicians);

  return () => {
    cancelled = true;
  };
}
