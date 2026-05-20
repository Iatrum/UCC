import { notFound } from "next/navigation";

import { loadEnabledModulePage } from "@/lib/module-registry";

export default async function AppointmentsPage() {
  const ModulePage = await loadEnabledModulePage("appointments");

  if (!ModulePage) {
    notFound();
  }

  return <ModulePage />;
}
