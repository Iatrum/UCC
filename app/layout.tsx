import "./globals.css";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import Toaster from "@/components/ui/toaster";
import Sidebar from "@/components/sidebar";
import { MedplumAuthProvider } from "@/lib/auth-medplum";
import { listActiveModules } from "@/lib/module-registry";
import { cookies, headers } from "next/headers";
import { IS_ADMIN_COOKIE, CLINIC_COOKIE } from "@/lib/server/cookie-constants";
import { clinicExists } from "@/lib/server/clinic-validation";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "UCC EMR",
  description: "Modern Electronic Medical Records System",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const modules = await listActiveModules();

  // Detect admin subdomain via cookie set by middleware
  const cookieStore = await cookies();
  const isAdminContext = cookieStore.get(IS_ADMIN_COOKIE)?.value === "true";

  // Validate clinic subdomain — redirect to error page for unknown clinics.
  // Skip on admin context, login, and /clinic-not-found itself.
  if (!isAdminContext) {
    const clinicId = cookieStore.get(CLINIC_COOKIE)?.value;
    const headerStore = await headers();
    const pathname = headerStore.get("x-pathname") ?? "";
    const isPublicPath =
      pathname.startsWith("/login") ||
      pathname.startsWith("/clinic-not-found") ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/_next");

    if (clinicId && !isPublicPath) {
      const exists = await clinicExists(clinicId);
      if (!exists) {
        redirect("/clinic-not-found");
      }
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MedplumAuthProvider>
        <div className="flex h-screen flex-col">
          <div className="flex flex-1 min-h-0">
                {/* Only show clinic sidebar on non-admin subdomains */}
                {!isAdminContext && (
                  <Sidebar
                    modules={modules.map((module) => ({
                      id: module.id,
                      label: module.label,
                      routePath: module.routePath,
                      icon: module.icon,
                    }))}
                  />
                )}
                <main className="flex-1 overflow-y-auto">
                  {isAdminContext ? (
                    children
                  ) : (
                    <div className="container p-8">{children}</div>
                  )}
                </main>
              </div>
            </div>
            <Toaster />
          </MedplumAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
