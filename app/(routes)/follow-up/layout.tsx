import { assertModuleEnabledForCurrentClinic } from "@/lib/module-registry";

export default async function FollowUpLayout({ children }: { children: React.ReactNode }) {
  await assertModuleEnabledForCurrentClinic("follow-up");
  return children;
}
