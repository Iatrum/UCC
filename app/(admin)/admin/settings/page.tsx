import Link from "next/link";
import { headers } from "next/headers";
import { adminPathForHost } from "@/lib/admin-routes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Server, Shield, Wrench } from "lucide-react";
import { configuredValue, isHttpUrl } from "@/lib/admin-ui";
import { getHostFromHeaders } from "@/lib/server/subdomain-host";

export default async function AdminSettingsPage() {
  const host = getHostFromHeaders(await headers());
  const adminPath = (path: string) => adminPathForHost(path, host);
  const medplumUi = configuredValue(process.env.NEXT_PUBLIC_MEDPLUM_UI_URL);
  const medplumApi = configuredValue(process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL);
  const baseDomain =
    process.env.NEXT_PUBLIC_BASE_DOMAIN || "yourdomain.com";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Platform configuration and developer tools.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> Platform
          </CardTitle>
          <CardDescription>Runtime configuration for this deployment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Base domain</span>
            <Badge variant="outline">{baseDomain}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Medplum API</span>
            {isHttpUrl(medplumApi) ? (
              <a
                href={medplumApi}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs inline-flex min-h-10 items-center gap-1 break-all hover:underline sm:min-h-0"
              >
                {medplumApi}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">Not configured</span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Medplum Console</span>
            {isHttpUrl(medplumUi) ? (
              <a
                href={medplumUi}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs inline-flex min-h-10 items-center gap-1 break-all hover:underline sm:min-h-0"
              >
                {medplumUi}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">Not configured</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Security
          </CardTitle>
          <CardDescription>
            Admin portal is gated behind the platform admin role. See
            <code className="mx-1 text-xs">docs/AUTH.md</code> for details.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Developer Tools
          </CardTitle>
          <CardDescription>
            Utilities for bootstrapping and debugging the Medplum project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" className="h-auto min-h-9 whitespace-normal text-left" asChild>
            <Link href={adminPath("/create-medplum-client")}>
              Create Medplum client credentials
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
