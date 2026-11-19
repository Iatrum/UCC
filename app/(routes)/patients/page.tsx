'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Clock, CheckCircle2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { getPatientsPage, getPatientStats, searchPatientsPage, type Patient } from "@/lib/fhir/patient-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMedplumAuth } from "@/lib/auth-medplum";

const PAGE_SIZE = 25;

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState({
    total: 0,
    new: 0,
    followUps: 0,
    inQueue: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { loading: authLoading } = useMedplumAuth();

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchQuery.trim();
      setDebouncedQuery((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Real clinic-scoped counts (server: _summary=count + _total=accurate)
  useEffect(() => {
    if (authLoading) return;
    getPatientStats()
      .then((s) => setStats((prev) => ({ ...prev, total: s.total ?? -1, new: s.newThisMonth ?? -1 })))
      .catch((err) => console.error('Error loading patient stats:', err));
  }, [authLoading]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;
    async function loadPatients() {
      setLoading(true);
      setError(null);
      try {
        let active: Patient[];
        if (debouncedQuery) {
          const res = await searchPatientsPage(debouncedQuery, page, PAGE_SIZE);
          active = res.patients;
          setTotal(res.total);
          setCapped(res.capped);
        } else {
          const res = await getPatientsPage(page, PAGE_SIZE);
          active = res.patients;
          setTotal(res.total);
          setCapped(false);
        }
        if (cancelled) return;
        setPatients(active);

        const now = new Date();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        setStats((prev) => ({
          ...prev,
          followUps: active.filter((p) => {
            const lastVisit = (p as any).lastVisit ? new Date((p as any).lastVisit) : null;
            return lastVisit && lastVisit >= weekStart;
          }).length,
          inQueue: active.filter((p) => ['arrived', 'waiting', 'in_consultation'].includes((p as any).queueStatus)).length,
        }));
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading patients from Medplum:', err);
        const message =
          err instanceof Error ? err.message : 'Failed to load patient data from FHIR.';
        setError(
          message.includes('Authentication required')
            ? `${message} If you are signed in, try refreshing the page.`
            : message
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPatients();
    return () => {
      cancelled = true;
    };
  }, [authLoading, page, debouncedQuery]);

  // Search is server-side; the list is already filtered.
  const filteredPatients = patients;
  const totalPages = total != null ? Math.min(Math.max(1, Math.ceil(total / PAGE_SIZE)), Math.floor(10000 / PAGE_SIZE) + 1) /* Medplum _offset ceiling */ : null;
  const hasNext = totalPages != null ? page < totalPages : false;
  const fmt = (n: number) => (n < 0 ? "—" : n.toLocaleString());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patients</h1>
          <p className="text-muted-foreground">
            Manage and view patient information
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/patients/new">
              <Plus className="mr-2 h-4 w-4" />
              New Patient
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <UserRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(stats.total)}</div>
            <p className="text-xs text-muted-foreground">Active patients in this clinic</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">New Patients</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(stats.new)}</div>
            <p className="text-xs text-muted-foreground">Registered this month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Follow-ups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.followUps}</div>
            <p className="text-xs text-muted-foreground">This week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">In Queue</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inQueue}</div>
            <p className="text-xs text-muted-foreground">Waiting for consultation</p>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Patient List</CardTitle>
          <CardDescription>
            View and manage all patient records
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full mb-4">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search patients..."
              className="pl-9 pr-4 py-2 w-full rounded-md border border-input bg-transparent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          {loading && <p>Loading...</p>}
          {error && <p className="text-red-500">{error}</p>}
          {!loading && !error && (
            <div className="mt-6 relative border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>NRIC</TableHead>
                    <TableHead>Gender</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Last Visit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.length > 0 ? (
                    filteredPatients.map((patient) => (
                      <TableRow key={patient.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/patients/${patient.id}`}
                            className="hover:underline"
                          >
                            {patient.fullName}
                          </Link>
                        </TableCell>
                        <TableCell>{patient.nric}</TableCell>
                        <TableCell>{patient.gender}</TableCell>
                        <TableCell>{patient.phone}</TableCell>
                        <TableCell>
                          {(patient as any).lastVisit 
                            ? new Date((patient as any).lastVisit).toLocaleDateString()
                            : 'No visits'}
                        </TableCell>
                        <TableCell>
                          {(patient as any).queueStatus === 'waiting' ? (
                            <Badge variant="secondary" className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              In Queue
                            </Badge>
                          ) : (patient as any).queueStatus === 'arrived' ? (
                            <Badge variant="outline" className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Arrived
                            </Badge>
                          ) : (patient as any).lastVisit ? (
                            <Badge variant="outline">Active</Badge>
                          ) : (
                            <Badge variant="outline">New</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm">
                            <Link href={`/patients/${patient.id}/check-in`}>
                              Check-in
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-4">
                        No patients found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {totalPages != null && (
                <div className="flex items-center justify-between border-t px-4 py-3 text-sm" data-testid="patients-pagination">
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages} · {total?.toLocaleString()}{capped ? "+" : ""} {debouncedQuery ? "matches" : "patients"}{capped ? " — refine your search to narrow results" : ""}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <Button size="sm" variant="outline" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
