'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";
import { BillableConsultation } from '@/lib/types';
import BillingTable from "@/components/billing/billing-table";
import { useToast } from "@/components/ui/use-toast";
import { CHECKOUT_NOTICE_STORAGE_KEY, checkoutToastDescription, type CheckoutStockNotice } from "@/lib/billing/checkout-stock";

interface OrdersClientProps {
  initialConsultations: BillableConsultation[];
  otcContext?: {
    patientId: string;
    patientName?: string;
  };
  checkoutComplete?: {
    invoiceId?: string;
    invoiceNumber?: string;
  };
}

export default function OrdersClient({ initialConsultations, otcContext, checkoutComplete }: OrdersClientProps) {
  const { toast } = useToast();
  const checkoutToastShown = useRef(false);
  const [consultations, setConsultations] = useState<BillableConsultation[]>(initialConsultations);
  const [stockNotice, setStockNotice] = useState<CheckoutStockNotice | null>(null);

  useEffect(() => {
    if (!checkoutComplete || checkoutToastShown.current) return;

    checkoutToastShown.current = true;
    // Task 504: stock problems from POST /api/billing (negative stock, unmatched line, failed deduction).
    let notice: CheckoutStockNotice | null = null;
    try {
      const raw = window.sessionStorage.getItem(CHECKOUT_NOTICE_STORAGE_KEY);
      window.sessionStorage.removeItem(CHECKOUT_NOTICE_STORAGE_KEY);
      notice = raw ? (JSON.parse(raw) as CheckoutStockNotice) : null;
    } catch {
      notice = null;
    }
    // sessionStorage only exists in the browser, so it is read here and applied after the effect body.
    if (notice) queueMicrotask(() => setStockNotice(notice));
    toast({
      title: notice ? "Checkout completed – check stock" : "Checkout completed",
      description: checkoutToastDescription(checkoutComplete.invoiceNumber || checkoutComplete.invoiceId || "record", notice),
    });

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("checkout");
    cleanUrl.searchParams.delete("invoiceId");
    cleanUrl.searchParams.delete("invoiceNumber");
    window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }, [checkoutComplete, toast]);

  useEffect(() => {
    let active = true;

    fetch("/api/orders/billable", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && Array.isArray(payload?.consultations)) {
          setConsultations(payload.consultations);
        }
      })
      .catch((error) => {
        console.error("Failed to refresh billable consultations:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6 container mx-auto py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing & Documents</h1>
        <p className="text-muted-foreground">
          Open checkout for completed consultations and manage visit documents.
        </p>
      </div>

      {stockNotice ? (
        <div
          role={stockNotice.severe ? "alert" : "status"}
          data-testid="checkout-stock-notice"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{stockNotice.title}</p>
            <button type="button" className="text-xs underline" onClick={() => setStockNotice(null)}>
              Dismiss
            </button>
          </div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {stockNotice.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {otcContext ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <p className="text-sm font-medium">OTC registration handoff received</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Patient {otcContext.patientName || otcContext.patientId} was sent from registration. Use search and complete billing actions for this patient.
            </p>
            <div className="mt-3">
              <Link href={`/patients/${otcContext.patientId}`} className="text-sm underline">
                Open patient profile
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ready for Billing</CardTitle>
          <CardDescription>Select a patient to open checkout.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillingTable consultations={consultations} />
        </CardContent>
      </Card>
    </div>
  );
}
