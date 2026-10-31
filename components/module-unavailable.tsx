import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ModuleUnavailable({ feature }: { feature: string }) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <h1 className="text-2xl font-semibold">{feature} is not enabled for this clinic yet</h1>
      <p className="text-muted-foreground">Please return to the Dashboard to continue.</p>
      <Button asChild>
        <Link href="/dashboard">Back to Dashboard</Link>
      </Button>
    </section>
  );
}
