import { SettingsSectionHeader } from "../settings-section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClinicalCatalogManager } from "@/components/catalogs/clinical-catalog-manager";

export default function CatalogSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Service Catalogs"
        description="Manage orderable catalogs used by the treatment composer, labs, imaging, generated letters, and diagnoses."
      />
      <Card>
        <CardHeader>
          <CardTitle>Catalogs</CardTitle>
        </CardHeader>
        <CardContent>
          <ClinicalCatalogManager />
        </CardContent>
      </Card>
    </div>
  );
}
