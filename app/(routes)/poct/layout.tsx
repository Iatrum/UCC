import { loadEnabledModulePage } from "@/lib/module-registry";
import { ModuleUnavailable } from "@/components/module-unavailable";

export default async function POCTLayout({ children }: { children: React.ReactNode }) {
  const ModulePage = await loadEnabledModulePage("poct");
  if (!ModulePage) {
    return <ModuleUnavailable feature="POCT" />;
  }
  return children;
}
