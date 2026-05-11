import { ModuleManager } from "@/components/settings/module-manager";

export default function AdminModulesPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Modules</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enable or disable features based on your clinic&apos;s requirements.
        </p>
      </div>
      <ModuleManager />
    </div>
  );
}
