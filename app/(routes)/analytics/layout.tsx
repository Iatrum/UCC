import { assertModuleEnabledForCurrentClinic } from "@/lib/module-registry";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await assertModuleEnabledForCurrentClinic("analytics");
  return children;
}
