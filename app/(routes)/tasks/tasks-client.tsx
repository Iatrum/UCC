"use client";

import { useEffect, useState, useTransition } from "react";
import type { Task } from "@medplum/fhirtypes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type TaskStatusFilter = "open" | "all";
type UpdateStatus = "in-progress" | "completed" | "cancelled";

function getExtensionString(task: Task, url: string): string {
  const ext = task.extension?.find((item) => item.url === url);
  return ext?.valueString || "";
}

function getConsultationId(task: Task): string {
  return getExtensionString(task, "https://ucc.emr/task/consultation-id");
}

function getErrorClass(task: Task): string {
  return getExtensionString(task, "https://ucc.emr/task/error-class");
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function statusBadge(status?: string) {
  if (status === "requested") return <Badge variant="secondary">Requested</Badge>;
  if (status === "in-progress") return <Badge>In Progress</Badge>;
  if (status === "completed") return <Badge variant="outline">Completed</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">{status || "Unknown"}</Badge>;
}

export function BillingExceptionTasksClient() {
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("open");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadTasks(filter: TaskStatusFilter) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?type=billing-exception&status=${filter}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Failed to load tasks");
      }
      setTasks(payload.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks(statusFilter);
  }, [statusFilter]);

  async function updateStatus(taskId: string, status: UpdateStatus) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || "Failed to update task");
        }
        await loadTasks(statusFilter);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update task");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing Exception Tasks</h1>
        <p className="text-muted-foreground mt-1">
          Clinic queue for billing failures that need operational follow-up.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-end justify-between">
          <div>
            <CardTitle>Queue</CardTitle>
            <CardDescription>Track and resolve billing exception tasks.</CardDescription>
          </div>
          <div className="w-44">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaskStatusFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open tasks</SelectItem>
                <SelectItem value="all">All tasks</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {error ? <p className="text-sm text-destructive mb-3">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tasks...</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks found for this filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Consultation</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>{formatDate(task.authoredOn || task.meta?.lastUpdated)}</TableCell>
                    <TableCell>{task.for?.reference || "-"}</TableCell>
                    <TableCell>{getConsultationId(task) || task.focus?.reference || "-"}</TableCell>
                    <TableCell className="max-w-[380px] truncate" title={task.description || ""}>
                      {task.description || getErrorClass(task) || "-"}
                    </TableCell>
                    <TableCell>{statusBadge(task.status)}</TableCell>
                    <TableCell className="space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending || task.status === "in-progress"}
                        onClick={() => updateStatus(task.id || "", "in-progress")}
                      >
                        In Progress
                      </Button>
                      <Button
                        size="sm"
                        disabled={isPending || task.status === "completed"}
                        onClick={() => updateStatus(task.id || "", "completed")}
                      >
                        Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isPending || task.status === "cancelled"}
                        onClick={() => updateStatus(task.id || "", "cancelled")}
                      >
                        Cancel
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

