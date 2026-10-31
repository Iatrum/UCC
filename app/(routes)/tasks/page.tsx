import { ModuleUnavailable } from "@/components/module-unavailable";

import { loadEnabledModulePage } from "@/lib/module-registry";

export default async function TasksPage() {
  const ModulePage = await loadEnabledModulePage("tasks");

  if (!ModulePage) {
    return <ModuleUnavailable feature="Tasks" />;
  }

  return <ModulePage />;
}
