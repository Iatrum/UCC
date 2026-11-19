import { headers } from "next/headers";
import { checkoutPreloadScript } from "@/lib/billing/checkout-preload";
import CheckoutClient from "./checkout-client";

type Props = {
  params: Promise<{ consultationId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CheckoutPage({ params, searchParams }: Props) {
  const fallbackSearchParams: { [key: string]: string | string[] | undefined } = {};
  const [{ consultationId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams?.catch(() => fallbackSearchParams) ?? fallbackSearchParams,
  ]);

  const patientId =
    typeof resolvedSearchParams.patientId === "string"
      ? resolvedSearchParams.patientId
      : "";

  // Task 684: start the critical reads at HTML-parse time instead of after hydration (same routes, same auth).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const preload = checkoutPreloadScript(consultationId, patientId);

  return (
    <>
      {preload ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: preload }} /> : null}
      <CheckoutClient consultationId={consultationId} patientId={patientId} />
    </>
  );
}
