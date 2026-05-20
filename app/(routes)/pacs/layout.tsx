import { assertModuleEnabledForCurrentClinic } from "@/lib/module-registry";

export default async function PACSLayout({ children }: { children: React.ReactNode }) {
  await assertModuleEnabledForCurrentClinic("pacs");
  return children;
}
