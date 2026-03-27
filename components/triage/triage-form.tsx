"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertCircle, 
  Activity, 
  Heart, 
  Wind, 
  Thermometer, 
  Droplets,
  Scale,
  Ruler
} from "lucide-react";
import { TriageLevel, TRIAGE_LEVELS, VitalSigns } from "@/lib/types";
import { Patient } from "@/lib/models";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface TriageFormProps {
  patient: Patient;
}

const RED_FLAG_OPTIONS = [
  "Chest pain",
  "Difficulty breathing",
  "Severe bleeding",
  "Altered consciousness",
  "Severe pain",
  "Suspected stroke",
  "Severe allergic reaction",
  "Head injury",
  "Abdominal pain",
  "Fever with confusion",
];

const TRIAGE_LEVEL_COLORS = {
  1: "bg-red-500 hover:bg-red-600 border-red-600",
  2: "bg-orange-500 hover:bg-orange-600 border-orange-600",
  3: "bg-yellow-500 hover:bg-yellow-600 border-yellow-600",
  4: "bg-green-500 hover:bg-green-600 border-green-600",
  5: "bg-blue-500 hover:bg-blue-600 border-blue-600",
};

export default function TriageForm({ patient }: TriageFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [triageLevel, setTriageLevel] = useState<TriageLevel>(3);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [triageNotes, setTriageNotes] = useState("");
  const [selectedRedFlags, setSelectedRedFlags] = useState<string[]>([]);
  
  // Vital signs state
  const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
    bloodPressureSystolic: undefined,
    bloodPressureDiastolic: undefined,
    heartRate: undefined,
    respiratoryRate: undefined,
    temperature: undefined,
    oxygenSaturation: undefined,
    painScore: undefined,
    weight: undefined,
    height: undefined,
  });

  const handleVitalSignChange = (key: keyof VitalSigns, value: string) => {
    const numValue = value === "" ? undefined : parseFloat(value);
    setVitalSigns(prev => ({ ...prev, [key]: numValue }));
  };

  const toggleRedFlag = (flag: string) => {
    setSelectedRedFlags(prev => 
      prev.includes(flag) 
        ? prev.filter(f => f !== flag)
        : [...prev, flag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!chiefComplaint.trim()) {
      toast({
        title: "Error",
        description: "Chief complaint is required",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patientId: patient.id,
          triageLevel,
          chiefComplaint,
          vitalSigns,
          triageNotes,
          redFlags: selectedRedFlags,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit triage");
      }

      toast({
        title: "Triage Complete",
        description: `${patient.fullName} has been triaged and added to the queue.`,
      });

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Error submitting triage:", error);
      toast({
        title: "Error",
        description: "Failed to complete triage. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedTriageInfo = TRIAGE_LEVELS[triageLevel];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Patient Info Header */}
      <Card>
        <CardHeader>
          <CardTitle>Patient Information</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          <div>
            <Label className="text-muted-foreground">Name</Label>
            <p className="font-medium">{patient.fullName}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">NRIC</Label>
            <p className="font-medium">{patient.nric}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Phone</Label>
            <p className="font-medium">{patient.phone}</p>
          </div>
        </CardContent>
      </Card>

      {/* Triage Level Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Triage Level</CardTitle>
          <CardDescription>Select the urgency level based on patient condition</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {([1, 2, 3, 4, 5] as TriageLevel[]).map((level) => {
              const info = TRIAGE_LEVELS[level];
              const isSelected = triageLevel === level;
              
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setTriageLevel(level)}
                  className={cn(
                    "p-4 rounded-lg border-2 text-white transition-all",
                    TRIAGE_LEVEL_COLORS[level],
                    isSelected ? "ring-4 ring-offset-2 ring-primary" : "opacity-70"
                  )}
                >
                  <div className="text-3xl font-bold mb-1">{level}</div>
                  <div className="text-sm font-semibold">{info.label}</div>
                  <div className="text-xs mt-1 opacity-90">{info.description}</div>
                </button>
              );
            })}
          </div>
          
          {selectedRedFlags.length > 0 && triageLevel >= 3 && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Red flags detected. Consider reassessing triage level.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Chief Complaint */}
      <Card>
        <CardHeader>
          <CardTitle>Chief Complaint</CardTitle>
          <CardDescription>Primary reason for visit</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            placeholder="E.g., Chest pain for 2 hours, shortness of breath..."
            rows={3}
            required
          />
        </CardContent>
      </Card>

      {/* Vital Signs */}
      <Card>
        <CardHeader>
          <CardTitle>Vital Signs</CardTitle>
          <CardDescription>Record patient vital signs</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          {/* Blood Pressure */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Blood Pressure (mmHg)
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                placeholder="Systolic"
                value={vitalSigns.bloodPressureSystolic ?? ""}
                onChange={(e) => handleVitalSignChange("bloodPressureSystolic", e.target.value)}
              />
              <span className="text-muted-foreground">/</span>
              <Input
                type="number"
                placeholder="Diastolic"
                value={vitalSigns.bloodPressureDiastolic ?? ""}
                onChange={(e) => handleVitalSignChange("bloodPressureDiastolic", e.target.value)}
              />
            </div>
          </div>

          {/* Heart Rate */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-muted-foreground" />
              Heart Rate (bpm)
            </Label>
            <Input
              type="number"
              placeholder="e.g., 75"
              value={vitalSigns.heartRate ?? ""}
              onChange={(e) => handleVitalSignChange("heartRate", e.target.value)}
            />
          </div>

          {/* Respiratory Rate */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Wind className="h-4 w-4 text-muted-foreground" />
              Respiratory Rate (breaths/min)
            </Label>
            <Input
              type="number"
              placeholder="e.g., 16"
              value={vitalSigns.respiratoryRate ?? ""}
              onChange={(e) => handleVitalSignChange("respiratoryRate", e.target.value)}
            />
          </div>

          {/* Temperature */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              Temperature (°C)
            </Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g., 37.0"
              value={vitalSigns.temperature ?? ""}
              onChange={(e) => handleVitalSignChange("temperature", e.target.value)}
            />
          </div>

          {/* Oxygen Saturation */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-muted-foreground" />
              SpO2 (%)
            </Label>
            <Input
              type="number"
              placeholder="e.g., 98"
              value={vitalSigns.oxygenSaturation ?? ""}
              onChange={(e) => handleVitalSignChange("oxygenSaturation", e.target.value)}
            />
          </div>

          {/* Pain Score */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              Pain Score (0-10)
            </Label>
            <Input
              type="number"
              min="0"
              max="10"
              placeholder="0 = No pain, 10 = Worst pain"
              value={vitalSigns.painScore ?? ""}
              onChange={(e) => handleVitalSignChange("painScore", e.target.value)}
            />
          </div>

          {/* Weight */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              Weight (kg)
            </Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g., 70.5"
              value={vitalSigns.weight ?? ""}
              onChange={(e) => handleVitalSignChange("weight", e.target.value)}
            />
          </div>

          {/* Height */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-muted-foreground" />
              Height (cm)
            </Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g., 170"
              value={vitalSigns.height ?? ""}
              onChange={(e) => handleVitalSignChange("height", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Red Flags */}
      <Card>
        <CardHeader>
          <CardTitle>Red Flags / Warning Signs</CardTitle>
          <CardDescription>Select any concerning symptoms or signs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {RED_FLAG_OPTIONS.map((flag) => (
              <Badge
                key={flag}
                variant={selectedRedFlags.includes(flag) ? "destructive" : "outline"}
                className="cursor-pointer text-sm py-2 px-3"
                onClick={() => toggleRedFlag(flag)}
              >
                {flag}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Triage Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Triage Notes</CardTitle>
          <CardDescription>Additional observations or concerns</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={triageNotes}
            onChange={(e) => setTriageNotes(e.target.value)}
            placeholder="Any additional observations, patient concerns, or relevant history..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Submit — sticky footer so it's always reachable without scrolling */}
      <div className="sticky bottom-0 z-10 bg-background border-t py-4 -mx-8 px-8 flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Completing Triage..." : "Complete Triage & Add to Queue"}
        </Button>
      </div>
    </form>
  );
}








