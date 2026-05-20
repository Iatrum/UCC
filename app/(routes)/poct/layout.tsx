import { assertModuleEnabledForCurrentClinic } from "@/lib/module-registry";

export default async function POCTLayout({ children }: { children: React.ReactNode }) {
  await assertModuleEnabledForCurrentClinic("poct");
  return children;
}
