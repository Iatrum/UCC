"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  FileText,
  Megaphone,
  Plus,
  ReceiptText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Patient, Consultation } from "@/lib/models";
import { formatDisplayDate } from "@/lib/utils";

type CheckoutClientProps = {
  consultationId: string;
  patientId: string;
};

type OrderDetails = {
  patient: Patient;
  consultation: Consultation;
};

type CheckoutItem = {
  id: string;
  name: string;
  description: string;
  type: "Item" | "Service";
  quantity: number;
  price: number;
};

const DEFAULT_CONSULTATION_FEE = 50;

function currency(amount: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(amount);
}

function buildCheckoutItems(consultation: Consultation | null): CheckoutItem[] {
  if (!consultation) return [];

  const procedures = (consultation.procedures || []).map((procedure, index) => ({
    id: `procedure-${index}`,
    name: procedure.name || "Procedure",
    description: procedure.notes || "Clinical service",
    type: "Service" as const,
    quantity: 1,
    price: procedure.price ?? 0,
  }));

  const prescriptions = (consultation.prescriptions || []).map((prescription, index) => ({
    id: `prescription-${index}`,
    name: prescription.medication?.name || "Medication",
    description: [prescription.medication?.strength, prescription.frequency, prescription.duration]
      .filter(Boolean)
      .join(" · "),
    type: "Item" as const,
    quantity: 1,
    price: prescription.price ?? 0,
  }));

  const items = [...procedures, ...prescriptions];
  const hasChargeableItem = items.some((item) => item.price > 0);

  if (hasChargeableItem) {
    return items;
  }

  return [
    {
      id: "consultation-fee",
      name: "Consultation Fee",
      description: consultation.chiefComplaint || "Default consultation charge",
      type: "Service",
      quantity: 1,
      price: DEFAULT_CONSULTATION_FEE,
    },
  ];
}

export default function CheckoutClient({ consultationId, patientId }: CheckoutClientProps) {
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDetails() {
      if (!consultationId || !patientId) {
        setError("Missing checkout patient or consultation reference.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/orders?consultationId=${encodeURIComponent(consultationId)}&patientId=${encodeURIComponent(patientId)}`
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.patient || !payload.consultation) {
          throw new Error(payload.error || "Failed to load checkout details.");
        }

        if (active) {
          setDetails({ patient: payload.patient, consultation: payload.consultation });
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load checkout details.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDetails();

    return () => {
      active = false;
    };
  }, [consultationId, patientId]);

  const checkoutItems = useMemo(
    () => buildCheckoutItems(details?.consultation ?? null),
    [details?.consultation]
  );
  const subtotal = checkoutItems.reduce((total, item) => total + item.quantity * item.price, 0);
  const paid = Number.parseFloat(paidAmount) || 0;
  const balance = Math.max(subtotal - paid, 0);
  const invoiceNumber = useMemo(
    () => `#${consultationId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "DRAFT"}`,
    [consultationId]
  );

  if (loading) {
    return (
      <main className="container mx-auto flex min-h-[70vh] items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">Loading checkout...</div>
      </main>
    );
  }

  if (error || !details) {
    return (
      <main className="container mx-auto max-w-3xl py-8">
        <Button asChild variant="ghost" className="mb-4">
          <Link href="/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Billing
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Checkout unavailable</CardTitle>
            <CardDescription>{error || "The selected consultation could not be loaded."}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const { patient, consultation } = details;
  const billToName =
    patient.billingPerson === "dependent" && patient.dependentName
      ? patient.dependentName
      : patient.fullName;

  return (
    <main className="container mx-auto space-y-6 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Button asChild variant="ghost" className="-ml-3 w-fit">
            <Link href="/orders">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Billing
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Invoice {invoiceNumber}</h1>
              <Badge variant={completed ? "default" : "secondary"}>
                {completed ? "Completed" : "Checkout"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {patient.fullName} · {formatDisplayDate(consultation.date)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline">
            <Megaphone className="mr-2 h-4 w-4" />
            Call in
          </Button>
          <Button variant="outline">
            <Activity className="mr-2 h-4 w-4" />
            View activity log
          </Button>
          <Button variant="outline">Switch old version</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Patient Summary</CardTitle>
              <CardDescription>Visit and billing context for this checkout.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Patient</p>
                <Link href={`/patients/${patient.id}`} className="mt-1 block font-medium text-primary hover:underline">
                  {patient.fullName}
                </Link>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">NRIC / Passport</p>
                <p className="mt-1 font-medium">{patient.nric || "N/A"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Phone</p>
                <p className="mt-1 font-medium">{patient.phone || "N/A"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bill To</CardTitle>
              <CardDescription>Self-pay and dependent billing information.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Billing person</p>
                <p className="mt-1 font-medium">{billToName}</p>
                {patient.billingPerson === "dependent" ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {patient.dependentRelationship || "Dependent"} · {patient.dependentPhone || "No phone recorded"}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Self</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Address</p>
                <p className="mt-1 text-sm">{patient.address || "No address recorded"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-4 md:flex md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Treatment</CardTitle>
                <CardDescription>Items, services, packages, and documents attached to this invoice.</CardDescription>
              </div>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add treatment
              </Button>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="all">
                <TabsList className="mb-4 flex w-full overflow-x-auto md:w-fit">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="items">Items</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                  <TabsTrigger value="packages">Packages</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                </TabsList>
                <TabsContent value="all">
                  <TreatmentRows items={checkoutItems} />
                </TabsContent>
                <TabsContent value="items">
                  <TreatmentRows items={checkoutItems.filter((item) => item.type === "Item")} emptyText="No items added." />
                </TabsContent>
                <TabsContent value="services">
                  <TreatmentRows items={checkoutItems.filter((item) => item.type === "Service")} emptyText="No services added." />
                </TabsContent>
                <TabsContent value="packages">
                  <EmptyPanel text="No packages added." />
                </TabsContent>
                <TabsContent value="documents">
                  <EmptyPanel text="No chargeable documents added." />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="h-5 w-5" />
                Totals
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{currency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-medium">{currency(0)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-lg font-semibold">
                <span>Total</span>
                <span>{currency(subtotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payments
              </CardTitle>
              <CardDescription>Record the amount collected before completing visitation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="payment-method">Payment method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="qr">QR / DuitNow</SelectItem>
                    <SelectItem value="panel">Panel claim</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paid-amount">Paid amount</Label>
                <Input
                  id="paid-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={paidAmount}
                  onChange={(event) => setPaidAmount(event.target.value)}
                />
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="font-semibold">{currency(balance)}</span>
                </div>
              </div>
              <Button variant="outline" className="w-full">
                <FileText className="mr-2 h-4 w-4" />
                Submit e-Invoice
              </Button>
              <Button className="w-full" disabled={balance > 0} onClick={() => setCompleted(true)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Complete visitation
              </Button>
              {balance > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Collect the full total to enable completion.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function TreatmentRows({
  items,
  emptyText = "No treatment added.",
}: {
  items: CheckoutItem[];
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <EmptyPanel text={emptyText} />;
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[1fr_80px_120px] bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground">
        <span>Treatment</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Amount</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[1fr_80px_120px] items-center border-t px-4 py-3 text-sm">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{item.name}</p>
              <Badge variant="outline">{item.type}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{item.description || "No description"}</p>
          </div>
          <span className="text-right">{item.quantity}</span>
          <span className="text-right font-medium">{currency(item.quantity * item.price)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
