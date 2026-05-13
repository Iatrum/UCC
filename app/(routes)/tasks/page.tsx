import { MEDPLUM_BILLING_EXCEPTION_TASKS_ENABLED } from "@/lib/features";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingExceptionTasksClient } from "./tasks-client";

export default function TasksPage() {
  if (!MEDPLUM_BILLING_EXCEPTION_TASKS_ENABLED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing Exception Tasks</CardTitle>
          <CardDescription>This pilot queue is disabled.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Enable <code>NEXT_PUBLIC_FEATURE_MEDPLUM_BILLING_EXCEPTION_TASKS=true</code> to use this queue.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <BillingExceptionTasksClient />;
}

