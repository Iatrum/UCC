import { loadEnabledModulePage } from "@/lib/module-registry";
import { ModuleUnavailable } from "@/components/module-unavailable";

export default async function PACSLayout({ children }: { children: React.ReactNode }) {
  const ModulePage = await loadEnabledModulePage("pacs");
  if (!ModulePage) {
    return <ModuleUnavailable feature="PACS" />;
  }
  return children;
}
