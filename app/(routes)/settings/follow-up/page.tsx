import { SettingsSectionHeader } from "../settings-section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FollowUpSettings } from "@/components/settings/follow-up-settings";

export default function FollowUpSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Follow Up"
        description="Manage WhatsApp delivery mode and templates for review requests and appointment reminders."
      />
      <Card>
        <CardHeader>
          <CardTitle>Follow Up Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <FollowUpSettings />
        </CardContent>
      </Card>
    </div>
  );
}
