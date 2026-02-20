"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Camera } from "lucide-react";
import Link from "next/link";
import { savePatient } from "@/lib/fhir/patient-client";
import { useRouter } from "next/navigation";
import React from "react";

const patientFormSchema = z
  .object({
    fullName: z.string().min(2, "Name must be at least 2 characters"),
    identifierType: z.enum(["nric", "non_malaysian_ic", "passport"]),
    identifierValue: z.string().min(3, "ID number is required"),
    dateOfBirth: z.string().optional().or(z.literal("")),
    gender: z.enum(["male", "female", "other"]),
    email: z.string().email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().regex(/^\+?[0-9]{8,15}$/, "Invalid phone number"),
    address: z.string().optional().or(z.literal("")),
    postalCode: z.string().regex(/^\d{5}$/, "Postal code must be 5 digits").optional().or(z.literal("")),
    emergencyContact: z.object({
      name: z.string().optional().or(z.literal("")),
      relationship: z.string().optional().or(z.literal("")),
      phone: z.string().regex(/^\+?[0-9]{8,15}$/, "Invalid phone number").optional().or(z.literal("")),
    }).optional(),
    medicalHistory: z.object({
      allergies: z.string().optional().or(z.literal("")),
    }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.identifierType === "nric") {
      if (!/^\d{6}-\d{2}-\d{4}$/.test(data.identifierValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["identifierValue"],
          message: "Invalid NRIC format (e.g., 880705-56-5975)",
        });
      }
    }
    if (!data.dateOfBirth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: "Date of Birth is required",
      });
    }
  });

type PatientFormValues = z.infer<typeof patientFormSchema>;

const RequiredLabel = ({ children }: { children: React.ReactNode }) => (
  <FormLabel className="after:content-[&quot;*&quot;] after:ml-0.5 after:text-red-500">
    {children}
  </FormLabel>
);

interface NewPatientFormProps {
  initialFullName?: string;
  initialNric?: string;
}

export default function NewPatientForm({ initialFullName = "", initialNric = "" }: NewPatientFormProps) {
  const { toast } = useToast();
  const router = useRouter();

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientFormSchema),
    defaultValues: {
      fullName: initialFullName,
      identifierType: "nric",
      identifierValue: initialNric,
      dateOfBirth: "",
      gender: undefined,
      email: "",
      phone: "",
      address: "",
      postalCode: "",
      medicalHistory: {
        allergies: "",
      },
      emergencyContact: {
        name: "",
        relationship: "",
        phone: "",
      },
    },
  });

  const formatNRIC = (value: string) => {
    const numbers = value.replace(/[^0-9]/g, '');
    if (numbers.length <= 6) {
      return numbers;
    } else if (numbers.length <= 8) {
      return `${numbers.slice(0, 6)}-${numbers.slice(6)}`;
    } else {
      return `${numbers.slice(0, 6)}-${numbers.slice(6, 8)}-${numbers.slice(8, 12)}`;
    }
  };

  const getNRICDate = (nric: string): string => {
    const birthDate = nric.slice(0, 6);
    const year = parseInt(birthDate.slice(0, 2));
    const month = parseInt(birthDate.slice(2, 4));
    const day = parseInt(birthDate.slice(4, 6));
    const fullYear = year + (year >= 30 ? 1900 : 2000);
    const formattedMonth = month.toString().padStart(2, '0');
    const formattedDay = day.toString().padStart(2, '0');
    return `${fullYear}-${formattedMonth}-${formattedDay}`;
  };

  const identifierType = form.watch('identifierType');
  const identifierValue = form.watch('identifierValue');

  React.useEffect(() => {
    if (identifierType !== "nric") {
      return;
    }
    if (identifierValue && identifierValue.length >= 6) {
      const birthDate = getNRICDate(identifierValue.replace(/[^0-9]/g, ''));
      form.setValue('dateOfBirth', birthDate);
    }
  }, [identifierType, identifierValue, form]);

  async function onSubmit(data: PatientFormValues) {
    try {
      let dateOfBirthObj: Date | undefined;
      if (data.dateOfBirth) {
        try {
          dateOfBirthObj = new Date(data.dateOfBirth);
          if (isNaN(dateOfBirthObj.getTime())) {
            dateOfBirthObj = undefined;
          }
        } catch {
          dateOfBirthObj = undefined;
        }
      }

      if (!dateOfBirthObj) {
        toast({ title: "Error", description: "Invalid or missing Date of Birth.", variant: "destructive" });
        return;
      }

      const dateOfBirthIso = dateOfBirthObj.toISOString().split('T')[0]; // YYYY-MM-DD

      const patientData = {
        fullName: data.fullName,
        dateOfBirth: dateOfBirthIso,
        gender: data.gender,
        phone: data.phone,
        email: data.email || undefined,
        address: data.address || "",
        postalCode: data.postalCode || undefined,
        identifierType: data.identifierType,
        identifierValue: data.identifierValue,
        nric: data.identifierValue,
        emergencyContact: (data.emergencyContact?.name || data.emergencyContact?.phone) ? {
          name: data.emergencyContact.name || "",
          relationship: data.emergencyContact.relationship || "",
          phone: data.emergencyContact.phone || "",
        } : undefined,
        medicalHistory: {
          allergies: data.medicalHistory?.allergies?.split(',').map(s => s.trim()).filter(Boolean) || [],
          conditions: [],
          medications: [],
        }
      };

      // 🎯 SAVE TO MEDPLUM (FHIR) - Source of Truth
      const patientId = await savePatient(patientData);
      
      toast({ 
        title: "Success", 
        description: "Patient registered successfully in FHIR" 
      });
      
      console.log(`✅ Patient saved to Medplum FHIR: ${patientId}`);
      
      router.push(`/patients/${patientId}`);
    } catch (error: any) {
      console.error('Failed to register patient:', error);
      toast({ 
        title: "Error", 
        description: error.message || "Failed to register patient. Please try again.", 
        variant: "destructive" 
      });
    }
  }

  return (
    <div className="container max-w-3xl py-6">
      <div className="mb-6">
        <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patients
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>New Patient Registration</CardTitle>
          <CardDescription>Enter the patient&#39;s personal and medical information</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <div className="space-y-6">
                <h3 className="text-lg font-medium">Personal Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="fullName" render={({ field }) => (
                    <FormItem>
                      <RequiredLabel>Full Name</RequiredLabel>
                      <FormControl>
                        <Input placeholder="Enter patient&apos;s full name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="identifierType" render={({ field }) => (
                    <FormItem>
                      <RequiredLabel>ID Type</RequiredLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select ID type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="nric">Malaysian NRIC</SelectItem>
                          <SelectItem value="non_malaysian_ic">Non-Malaysian IC</SelectItem>
                          <SelectItem value="passport">Passport</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="identifierValue" render={({ field }) => (
                    <FormItem>
                      <RequiredLabel>ID Number</RequiredLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input
                            placeholder={identifierType === "passport" ? "Enter passport number" : "YYMMDD-SS-NNNN"}
                            {...field}
                            onChange={(e) => {
                              const value = identifierType === "nric" ? formatNRIC(e.target.value) : e.target.value;
                              field.onChange(value);
                            }}
                          />
                          {identifierType === "nric" && (
                            <Button
                              type="button"
                              variant="secondary"
                              className="whitespace-nowrap"
                              onClick={() => {
                                const current = form.getValues();
                                const q = new URLSearchParams({
                                  fullName: current.fullName || "",
                                  nric: current.identifierValue || "",
                                }).toString();
                                router.push(`/patients/new/scan?${q}`);
                              }}
                            >
                              <Camera className="mr-1.5 h-4 w-4" /> Scan NRIC
                            </Button>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Birth</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          placeholder={identifierType === "nric" ? "Auto-filled from NRIC" : "Select date of birth"}
                          {...field}
                          disabled={identifierType === "nric"}
                          className={identifierType === "nric" ? "bg-muted" : undefined}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gender" render={({ field }) => (
                    <FormItem>
                      <RequiredLabel>Gender</RequiredLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-lg font-medium">Contact Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <RequiredLabel>Contact Number</RequiredLabel>
                      <FormControl>
                        <Input placeholder="Enter contact number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Enter full address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="postalCode" render={({ field }) => (
                    <FormItem className="md:col-start-2">
                      <FormLabel>Postal Code</FormLabel>
                      <FormControl>
                        <Input placeholder="12345" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-lg font-medium">Emergency Contact</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="emergencyContact.name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="emergencyContact.relationship" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Relationship</FormLabel>
                      <FormControl>
                        <Input placeholder="Spouse" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="emergencyContact.phone" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Contact Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+65 1234 5678" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-lg font-medium">Medical History</h3>
                <div className="space-y-4">
                  <FormField control={form.control} name="medicalHistory.allergies" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Allergies</FormLabel>
                      <FormControl>
                        <Textarea placeholder="List any known allergies" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  
                </div>
              </div>

              <div className="flex justify-end space-x-4">
                <Button variant="outline" type="button" asChild>
                  <Link href="/patients">Cancel</Link>
                </Button>
                <Button type="submit">Register Patient</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}


