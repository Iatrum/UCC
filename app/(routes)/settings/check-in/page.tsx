import { SettingsSectionHeader } from "../settings-section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InsurerManager } from "@/components/settings/insurer-manager";

export default function CheckInSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Check In"
        description="Manage panel insurers available during patient arrival and triage."
      />
      <Card>
        <CardHeader>
          <CardTitle>Panel Insurers</CardTitle>
        </CardHeader>
        <CardContent>
          <InsurerManager />
        </CardContent>
      </Card>
    </div>
  );
}
