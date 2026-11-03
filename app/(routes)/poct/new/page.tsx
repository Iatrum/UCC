import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TestTube } from "lucide-react";
import Link from "next/link";

export default function NewPOCTOrderPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/poct">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <TestTube className="h-8 w-8" />
            Order a POCT test
          </h1>
          <p className="text-muted-foreground mt-2">
            POCT orders require an online analyser and are placed from the patient&apos;s record.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Use the Treatment composer</CardTitle>
          <CardDescription>
            Point-of-care tests can only be ordered while the clinic&apos;s analyser is online, and
            results are never entered manually. Open the patient, start (or continue) a consultation,
            and add the test from the POCT section of the Treatment composer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/patients">Find a patient</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
