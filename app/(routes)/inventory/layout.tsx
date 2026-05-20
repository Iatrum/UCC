import { assertModuleEnabledForCurrentClinic } from "@/lib/module-registry";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  await assertModuleEnabledForCurrentClinic("inventory");
  return children;
}
