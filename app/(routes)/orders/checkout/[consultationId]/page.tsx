import CheckoutClient from "./checkout-client";

type Props = {
  params: Promise<{ consultationId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CheckoutPage({ params, searchParams }: Props) {
  const [{ consultationId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams?.catch(() => ({})) ?? {},
  ]);

  const patientId =
    typeof resolvedSearchParams.patientId === "string"
      ? resolvedSearchParams.patientId
      : "";

  return <CheckoutClient consultationId={consultationId} patientId={patientId} />;
}
