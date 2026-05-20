import { assertModuleEnabledForCurrentClinic } from "@/lib/module-registry";

export default async function AppointmentsLayout({ children }: { children: React.ReactNode }) {
  await assertModuleEnabledForCurrentClinic("appointments");
  return children;
}
