"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Patient } from "@/lib/models";
import { calculateAge } from "@/lib/utils";

// Define a type for the serialized patient data expected by this client component
// Ensure ALL potential date/timestamp fields from Patient model are omitted and then added back as string | null | undefined
export type SerializedPatient = Omit<Patient,
  'dateOfBirth' |
  'createdAt' |
  'lastVisit' |
  'upcomingAppointment' |
  'queueAddedAt' |
  'updatedAt' |
  'email' |
  'postalCode' |
  'address' |
  'emergencyContact' |
  'medicalHistory'
> & {
  email?: string;
  postalCode?: string;
  address?: string;
  emergencyContact?: { name: string; relationship: string; phone: string };
  medicalHistory?: { allergies: string[]; conditions: string[]; medications: string[] };
  dateOfBirth?: string | null | undefined;
  createdAt?: string | null | undefined;
  lastVisit?: string | null | undefined;
  upcomingAppointment?: string | null | undefined;
  queueAddedAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
};

interface PatientCardProps {
  patient: SerializedPatient;
  compact?: boolean;
}

export function PatientCard({ patient, compact = false }: PatientCardProps) {
  if (compact) {
    return (
      <Card className="border-none shadow-sm bg-gradient-to-br from-primary/5 to-primary/10">
        <CardContent className="p-2">
          <p className="text-base font-semibold">{patient.fullName}</p>
          <p className="text-xs text-muted-foreground">{patient.nric}</p>
        </CardContent>
      </Card>
    );
  }

  const age = calculateAge(patient.dateOfBirth);
  const isNewPatient = !patient.lastVisit;

  const initials = patient.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");

  return (
    <Card className="border-none shadow-sm bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent className="p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <span className="text-lg font-semibold text-primary">{initials}</span>
          </div>

          <div className="w-full text-center">
            <p className="font-semibold text-foreground leading-tight">{patient.fullName}</p>
            {isNewPatient && (
              <Badge variant="secondary" className="mt-1 text-[10px]">New patient</Badge>
            )}
          </div>

          <dl className="w-full space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">NRIC</dt>
              <dd className="font-medium text-foreground text-right truncate">{patient.nric || "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">Age</dt>
              <dd className="font-medium text-foreground text-right">
                {age !== null ? `${age} years` : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">Gender</dt>
              <dd className="font-medium text-foreground text-right capitalize">{patient.gender || "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">Phone</dt>
              <dd className="font-medium text-foreground text-right">{patient.phone || "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">Email</dt>
              <dd className="font-medium text-foreground text-right truncate">{patient.email || "—"}</dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
