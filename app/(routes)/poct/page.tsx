import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, TestTube, Clock, CheckCircle, AlertCircle } from "lucide-react";
import Link from "next/link";
import { getClinicPoctOrders, type PoctOrderSummary } from "@/lib/fhir/lab-service";
import { resolveClinicIdFromServerScope } from "@/lib/server/clinic";
import { getMedplumForRequest } from "@/lib/server/medplum-auth";

export const dynamic = "force-dynamic";

function isToday(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatOrderedAt(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function OrderList({ orders, emptyIcon: Icon, emptyText }: {
  orders: PoctOrderSummary[];
  emptyIcon: typeof TestTube;
  emptyText: string;
}) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Icon className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {orders.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className="font-medium">{order.testName}</p>
            <p className="text-sm text-muted-foreground">
              <Link href={`/patients/${order.patientId}`} className="hover:underline">{order.patientName}</Link>
              {" · "}
              {formatOrderedAt(order.authoredOn)}
            </p>
          </div>
          <span className="text-xs font-medium uppercase text-muted-foreground">{order.status}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function POCTPage() {
  const [medplum, clinicId] = await Promise.all([
    getMedplumForRequest(),
    resolveClinicIdFromServerScope(),
  ]);
  const orders = clinicId ? await getClinicPoctOrders(clinicId, medplum) : [];

  const todaysOrders = orders.filter((order) => isToday(order.authoredOn));
  const pending = todaysOrders.filter((order) => order.status === "active");
  const completed = todaysOrders.filter((order) => order.status === "completed");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <TestTube className="h-8 w-8" />
            Point of Care Testing (POCT)
          </h1>
          <p className="text-muted-foreground mt-2">
            On-site laboratory testing and results management
          </p>
        </div>
        <Button asChild>
          <Link href="/poct/new">
            <Plus className="mr-2 h-4 w-4" /> New Test Order
          </Link>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Today&apos;s Tests</CardTitle>
            <TestTube className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todaysOrders.length}</div>
            <p className="text-xs text-muted-foreground">Total tests ordered</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pending.length}</div>
            <p className="text-xs text-muted-foreground">Awaiting results</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completed.length}</div>
            <p className="text-xs text-muted-foreground">Results ready</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Abnormal</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending Tests</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="all">All Tests</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle>Pending Tests</CardTitle>
              <CardDescription>Tests awaiting performance or results</CardDescription>
            </CardHeader>
            <CardContent>
              <OrderList
                orders={orders.filter((order) => order.status === "active")}
                emptyIcon={TestTube}
                emptyText="No pending tests"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed">
          <Card>
            <CardHeader>
              <CardTitle>Completed Tests</CardTitle>
              <CardDescription>Tests with results available</CardDescription>
            </CardHeader>
            <CardContent>
              <OrderList
                orders={completed}
                emptyIcon={CheckCircle}
                emptyText="No completed tests today"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Tests</CardTitle>
              <CardDescription>Complete test history</CardDescription>
            </CardHeader>
            <CardContent>
              <OrderList orders={orders} emptyIcon={TestTube} emptyText="No tests recorded" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
