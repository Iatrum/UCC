"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban, CircleCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import type {
  ClinicSummary,
  PractitionerDetail,
} from "@/lib/fhir/admin-service";
import { useAdminPath } from "@/hooks/use-admin-path";

interface Props {
  user: PractitionerDetail;
  clinics: ClinicSummary[];
  isSelf: boolean;
}

export default function UserEditForm({ user, clinics, isSelf }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const adminPath = useAdminPath();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [active, setActive] = useState(user.active);
  const [form, setForm] = useState({
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  });
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(
    new Set(user.organizationIds)
  );

  const handleChange =
    (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const toggleOrg = (orgId: string, checked: boolean) => {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orgId);
      else next.delete(orgId);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({
        title: "First and last name are required",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          organizationIds: Array.from(selectedOrgIds),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save user");
      }
      toast({
        title: "Saved",
        description: `${form.firstName} ${form.lastName} has been updated.`,
      });
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete user");
      }
      toast({
        title: "User deleted",
        description: `${user.name} has been removed.`,
      });
      window.location.assign(adminPath("/users"));
    } catch (err: any) {
      toast({
        title: "Cannot delete",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (nextActive: boolean) => {
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update user status");
      }
      setActive(nextActive);
      toast({
        title: nextActive ? "User reactivated" : "User deactivated",
        description: nextActive
          ? `${user.name} can sign in again.`
          : `${user.name} can no longer sign in or access the clinic.`,
      });
      router.refresh();
    } catch (err: any) {
      toast({
        title: nextActive ? "Cannot reactivate" : "Cannot deactivate",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setStatusSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={adminPath("/users")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
            <Badge variant={active ? "secondary" : "destructive"}>
              {active === null ? "No login" : active ? "Active" : "Deactivated"}
            </Badge>
          </div>
          {user.email && (
            <p className="text-muted-foreground text-sm">{user.email}</p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account Access</CardTitle>
          <CardDescription>
            {active === null
              ? "No login is linked to this user in the managed project."
              : active
              ? "This user can sign in and access their assigned clinics."
              : "This user cannot sign in or access any clinic. Their profile, roles, and history are unchanged."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {active === null ? (
            <p className="text-sm text-muted-foreground">No login available to manage.</p>
          ) : isSelf ? (
            <p className="text-sm text-muted-foreground">
              You cannot deactivate your own account.
            </p>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant={active ? "outline" : "default"}
                  disabled={statusSaving}
                >
                  {active ? (
                    <Ban className="h-4 w-4 mr-2" />
                  ) : (
                    <CircleCheck className="h-4 w-4 mr-2" />
                  )}
                  {statusSaving
                    ? "Saving..."
                    : active
                      ? "Deactivate User"
                      : "Reactivate User"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {active ? "Deactivate" : "Reactivate"} {user.name}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {active
                      ? "They will immediately lose the ability to sign in or access any clinic. Their Practitioner profile, roles, and history are kept and this can be reversed at any time."
                      : "They will be able to sign in and access their assigned clinics again."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleStatusChange(!active)}>
                    {active ? "Deactivate" : "Reactivate"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update the practitioner&apos;s display name. Email cannot be
            changed after invitation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={handleChange("firstName")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={handleChange("lastName")}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Clinic Assignments</Label>
              {clinics.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No clinics available.
                </p>
              ) : (
                <div className="space-y-2 border rounded-md p-3">
                  {clinics.map((clinic) => {
                    const checked = selectedOrgIds.has(clinic.id);
                    return (
                      <label
                        key={clinic.id}
                        className="flex items-center gap-3 cursor-pointer py-1"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            toggleOrg(clinic.id, v === true)
                          }
                        />
                        <span className="flex-1 text-sm">
                          {clinic.name}{" "}
                          <span className="text-muted-foreground text-xs">
                            ({clinic.subdomain})
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Users must have at least one clinic assignment to sign in to a
                clinic subdomain.
              </p>
            </div>

            <div className="pt-2 flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href={adminPath("/users")}>Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Deleting a user revokes their Medplum access and removes all clinic
            assignments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {deleting ? "Deleting..." : "Delete User"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {user.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the Practitioner resource, all PractitionerRole
                  assignments, and the associated ProjectMembership. The user
                  will no longer be able to sign in.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
