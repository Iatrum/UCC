/**
 * Labs and Imaging Page for Patient
 * 
 * Allows ordering and viewing lab tests and imaging studies for a patient
 */

import { Suspense } from 'react';
import { LabOrderForm } from '@/components/labs/lab-order-form';
import { LabResultsView } from '@/components/labs/lab-results-view';
import { ImagingOrderForm } from '@/components/imaging/imaging-order-form';
import { ImagingResultsView } from '@/components/imaging/imaging-results-view';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TestTube2, Camera } from 'lucide-react';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { resolveClinicIdFromServerScope } from '@/lib/server/clinic';
import { imagingOrderEntryMode } from '@/lib/imaging/order-entry';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function PatientLabsImagingPage({ params }: Props) {
  const resolvedParams = await params;
  const patientId = resolvedParams.id;
  const clinicId = await resolveClinicIdFromServerScope();
  const pacsEnabled = await isModuleEnabledForClinic('pacs', clinicId).catch(() => false);
  const orderMode = imagingOrderEntryMode(pacsEnabled);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">Labs & Imaging</h1>
      </div>

      <Tabs defaultValue="labs" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="labs" className="gap-2">
            <TestTube2 className="h-4 w-4" />
            Laboratory Tests
          </TabsTrigger>
          <TabsTrigger value="imaging" className="gap-2">
            <Camera className="h-4 w-4" />
            Imaging Studies
          </TabsTrigger>
        </TabsList>

        {/* Laboratory Tests Tab */}
        <TabsContent value="labs" className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Order Lab Tests */}
            <div>
              <Suspense fallback={<Skeleton className="h-96" />}>
                <LabOrderForm patientId={patientId} />
              </Suspense>
            </div>

            {/* Lab Results */}
            <div>
              <Suspense fallback={<Skeleton className="h-96" />}>
                <LabResultsView patientId={patientId} />
              </Suspense>
            </div>
          </div>
        </TabsContent>

        {/* Imaging Studies Tab */}
        <TabsContent value="imaging" className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Order Imaging */}
            <div>
              {orderMode === 'treatment-panel-only' ? (
                <Card data-testid="xray-order-from-treatment">
                  <CardHeader>
                    <CardTitle>Order imaging</CardTitle>
                    <CardDescription>X-ray is ordered from the Treatment panel</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Open the patient profile, start a consult, add the X-ray in the Treatment panel and sign.
                    This links the order to the accession number so incoming images match automatically.
                  </CardContent>
                </Card>
              ) : (
                <Suspense fallback={<Skeleton className="h-96" />}>
                  <ImagingOrderForm patientId={patientId} />
                </Suspense>
              )}
            </div>

            {/* Imaging Results */}
            <div>
              <Suspense fallback={<Skeleton className="h-96" />}>
                <ImagingResultsView patientId={patientId} />
              </Suspense>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}








