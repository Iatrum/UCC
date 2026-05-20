import { notFound } from "next/navigation";

import { loadEnabledModulePage } from "@/lib/module-registry";

export default async function NewAppointmentPage() {
  const ModulePage = await loadEnabledModulePage("appointments", "create");

  if (!ModulePage) {
    notFound();
  }

  return <ModulePage />;
}
