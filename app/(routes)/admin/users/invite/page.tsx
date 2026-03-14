"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

type ClinicOption = {
  id: string;
  name: string;
  subdomain: string;
};

export default function InviteUserPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [clinics, setClinics] = useState<ClinicOption[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    clinicId: "",
  });

  const handleChange =
    (field: "firstName" | "lastName" | "email") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  useEffect(() => {
    const loadClinics = async () => {
      try {
        const res = await fetch("/api/admin/clinics");
        if (!res.ok) {
          throw new Error("Failed to load clinics");
        }
        const data = await res.json();
        const clinicList = (data.clinics ?? []) as ClinicOption[];
        setClinics(clinicList);
        if (clinicList.length > 0) {
          setForm((prev) => ({ ...prev, clinicId: clinicList[0].id }));
        }
      } catch (err: any) {
        toast({
          title: "Unable to load clinics",
          description: err.message || "Please refresh and try again",
          variant: "destructive",
        });
      } finally {
        setLoadingClinics(false);
      }
    };

    loadClinics();
  }, [toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.clinicId) {
      toast({ title: "Missing required fields", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          clinicId: form.clinicId,
          sendEmail: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to invite user");
      }

      toast({
        title: "Invitation sent",
        description: `${form.firstName} ${form.lastName} has been invited.`,
      });
      router.replace("/admin/users");
    } catch (err: any) {
      toast({
        title: "Invite failed",
        description: err.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invite User</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Send a Medplum invitation to a practitioner.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Practitioner Details</CardTitle>
          <CardDescription>The invited user will receive an email invitation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clinicId">Clinic *</Label>
              <Select
                value={form.clinicId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, clinicId: value }))}
                disabled={loadingClinics || clinics.length === 0}
              >
                <SelectTrigger id="clinicId">
                  <SelectValue placeholder={loadingClinics ? "Loading clinics..." : "Select clinic"} />
                </SelectTrigger>
                <SelectContent>
                  {clinics.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name} ({clinic.subdomain})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={handleChange("firstName")}
                required
                placeholder="Aina"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={handleChange("lastName")}
                required
                placeholder="Rahman"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={handleChange("email")}
                required
                placeholder="doctor@clinic.com"
              />
            </div>

            <div className="pt-2 flex gap-3">
              <Button type="submit" disabled={loading || loadingClinics || clinics.length === 0}>
                {loading ? "Sending Invite..." : "Send Invite"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/admin/users">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
