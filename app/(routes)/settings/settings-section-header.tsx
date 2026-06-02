import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SettingsSectionHeaderProps {
  title: string;
  description: string;
}

export function SettingsSectionHeader({ title, description }: SettingsSectionHeaderProps) {
  return (
    <div className="space-y-4">
      <Button asChild variant="outline" size="sm">
        <Link href="/settings">
          <ArrowLeft className="h-4 w-4" />
          Settings
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
