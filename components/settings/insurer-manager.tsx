"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2, Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { fetchInsurers, addInsurer, updateInsurer, deleteInsurer, type Insurer } from "@/lib/insurers";

export function InsurerManager() {
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Insurer | null>(null);
  const [formData, setFormData] = useState({ name: "", value: "" });
  const { toast } = useToast();

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      setInsurers(await fetchInsurers());
    } catch {
      toast({ title: "Error", description: "Failed to load insurers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditing(null);
    setFormData({ name: "", value: "" });
    setOpen(true);
  };

  const handleEdit = (insurer: Insurer) => {
    setEditing(insurer);
    setFormData({ name: insurer.name, value: insurer.value });
    setOpen(true);
  };

  const slugify = (name: string) =>
    name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  const handleSave = async () => {
    const name = formData.name.trim();
    const value = formData.value.trim() || slugify(formData.name);

    if (!name || !value) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }

    try {
      if (editing?.id) {
        await updateInsurer(editing.id, { name, value });
        toast({ title: "Success", description: "Insurer updated" });
      } else {
        await addInsurer({ name, value });
        toast({ title: "Success", description: "Insurer added" });
      }
      setOpen(false);
      load();
    } catch {
      toast({ title: "Error", description: "Failed to save insurer", variant: "destructive" });
    }
  };

  const handleDelete = async (insurer: Insurer) => {
    if (!insurer.id) return;
    if (!confirm(`Delete insurer "${insurer.name}"?`)) return;

    try {
      await deleteInsurer(insurer.id);
      toast({ title: "Success", description: "Insurer deleted" });
      load();
    } catch {
      toast({ title: "Error", description: "Failed to delete insurer", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage panel insurers available for selection during patient check-in.
        </p>
        <Button onClick={handleAdd} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Insurer
        </Button>
      </div>

      {insurers.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No insurers configured. Click &quot;Add Insurer&quot; to add one.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {insurers.map((insurer) => (
                <TableRow key={insurer.id}>
                  <TableCell>{insurer.name}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{insurer.value}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(insurer)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(insurer)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Insurer" : "Add Insurer"}</DialogTitle>
            <DialogDescription>
              Panel insurers appear as payment method options during patient check-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="insurer-name">Name</Label>
              <Input
                id="insurer-name"
                placeholder="e.g. Intracare Sdn Bhd"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value, value: slugify(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="insurer-value">Value (internal identifier)</Label>
              <Input
                id="insurer-value"
                placeholder="e.g. intracare_sdn_bhd"
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Auto-generated from name. Used internally to identify this insurer.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
