import { SettingsSectionHeader } from "../settings-section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentTemplateEditor } from "@/components/settings/document-template-editor";

export default function DocumentSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Document Templates"
        description="Customise the HTML layout for Medical Certificates and Referral Letters."
      />
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentTemplateEditor />
        </CardContent>
      </Card>
    </div>
  );
}
