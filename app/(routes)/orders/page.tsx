export const dynamic = 'force-dynamic';

import { getConsultationsWithDetails } from "@/lib/models";
import { QueueStatus } from '@/lib/types';
import OrdersClient from "./orders-client";

type SearchParams = { [key: string]: string | string[] | undefined };
type Props = {
  searchParams?: Promise<SearchParams>;
};

export default async function OrdersPage({ searchParams }: Props) {
  const resolvedParams: SearchParams = searchParams
    ? await searchParams.catch(() => ({} as SearchParams))
    : {};
  const otcPatientId = typeof resolvedParams.patientId === "string" ? resolvedParams.patientId : "";
  const otcPatientName = typeof resolvedParams.patientName === "string" ? resolvedParams.patientName : "";
  const source = typeof resolvedParams.source === "string" ? resolvedParams.source : "";
  const checkout = typeof resolvedParams.checkout === "string" ? resolvedParams.checkout : "";
  const invoiceId = typeof resolvedParams.invoiceId === "string" ? resolvedParams.invoiceId : "";
  const invoiceNumber = typeof resolvedParams.invoiceNumber === "string" ? resolvedParams.invoiceNumber : "";

  const statuses: QueueStatus[] = ['meds_and_bills'];
  const consultations = await getConsultationsWithDetails(statuses);

  return (
    <OrdersClient
      initialConsultations={consultations}
      otcContext={
        source === "registration-otc" && otcPatientId
          ? { patientId: otcPatientId, patientName: otcPatientName }
          : undefined
      }
      checkoutComplete={
        checkout === "completed"
          ? { invoiceId, invoiceNumber }
          : undefined
      }
    />
  );
}
