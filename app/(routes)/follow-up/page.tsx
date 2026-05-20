export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { loadEnabledModulePage } from "@/lib/module-registry";

export default async function FollowUpPage() {
  const ModulePage = await loadEnabledModulePage("follow-up");

  if (!ModulePage) {
    notFound();
  }

  return <ModulePage />;
}
