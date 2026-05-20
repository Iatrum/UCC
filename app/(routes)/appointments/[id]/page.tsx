import { notFound } from "next/navigation";

import { loadEnabledModulePage } from "@/lib/module-registry";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function AppointmentDetailsPage(props: Props) {
  const ModulePage = await loadEnabledModulePage("appointments", "detail");

  if (!ModulePage) {
    notFound();
  }

  return <ModulePage {...props} />;
}
