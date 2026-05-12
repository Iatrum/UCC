"use client";

import * as React from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import ProceduresTable from "@/components/inventory/procedures-table";
import { type ClinicalCatalogItem, type ClinicalCatalogType } from "@/lib/clinical-catalog";
import {
  createProcedure,
  deleteProcedure,
  getProcedures,
  type ProcedureItem,
  updateProcedure,
} from "@/lib/procedures";

export type CatalogManagerType = ClinicalCatalogType | "procedure";

const TYPE_LABELS: Record<CatalogManagerType, string> = {
  procedure: "Procedures",
  lab: "Lab Tests",
  imaging: "Imaging",
  document: "Document Types",
};

const EMPTY_FORM: Omit<ClinicalCatalogItem, "id"> = {
  type: "lab",
  name: "",
  code: "",
  system: "",
  display: "",
  category: "",
  modality: "",
  defaultPrice: 0,
  active: true,
  notes: "",
};

export interface ClinicalCatalogManagerProps {
  types?: CatalogManagerType[];
  defaultType?: CatalogManagerType;
  className?: string;
  onCatalogChange?: (type: ClinicalCatalogType, items: ClinicalCatalogItem[]) => void;
}

export function ClinicalCatalogManager({
  types = ["lab", "imaging", "document", "procedure"],
  defaultType,
  className,
  onCatalogChange,
}: ClinicalCatalogManagerProps) {
  const { toast } = useToast();
  const visibleTypes = React.useMemo(
    () => types.filter((type, index, list) => list.indexOf(type) === index),
    [types]
  );
  const [activeType, setActiveType] = React.useState<CatalogManagerType>(
    defaultType && visibleTypes.includes(defaultType) ? defaultType : visibleTypes[0] || "lab"
  );
  const [items, setItems] = React.useState<Record<ClinicalCatalogType, ClinicalCatalogItem[]>>({
    lab: [],
    imaging: [],
    document: [],
  });
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<ClinicalCatalogItem | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deletingIds, setDeletingIds] = React.useState<Record<string, boolean>>({});
  const [procedures, setProcedures] = React.useState<ProcedureItem[]>([]);
  const [procedureSearch, setProcedureSearch] = React.useState("");
  const [procedureLoading, setProcedureLoading] = React.useState(false);

  const loadType = React.useCallback(async (type: ClinicalCatalogType) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/catalogs?type=${type}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load catalog.");
      }
      const nextItems = data.items || [];
      setItems((prev) => ({ ...prev, [type]: nextItems }));
      onCatalogChange?.(type, nextItems);
    } catch (error) {
      toast({
        title: "Catalog unavailable",
        description: error instanceof Error ? error.message : "Failed to load catalog.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [onCatalogChange, toast]);

  React.useEffect(() => {
    if (!visibleTypes.includes(activeType)) {
      setActiveType(visibleTypes[0] || "lab");
    }
  }, [activeType, visibleTypes]);

  React.useEffect(() => {
    if (activeType === "procedure") {
      void loadProcedures();
      return;
    }
    void loadType(activeType);
  }, [activeType, loadType]);

  async function loadProcedures() {
    setProcedureLoading(true);
    try {
      setProcedures(await getProcedures());
    } catch (error) {
      toast({
        title: "Procedures unavailable",
        description: error instanceof Error ? error.message : "Failed to load procedures.",
        variant: "destructive",
      });
    } finally {
      setProcedureLoading(false);
    }
  }

  const clinicalType = activeType === "procedure" ? "lab" : activeType;
  const savedItems = activeType === "procedure" ? [] : items[clinicalType];
  const rows = activeType === "procedure" ? [] : savedItems;
  const filteredRows = rows.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [item.name, item.code, item.category, item.modality, item.display].some((value) =>
      (value || "").toLowerCase().includes(q)
    );
  });

  async function persistItem(item: Omit<ClinicalCatalogItem, "id">, id?: string) {
    const method = id ? "PATCH" : "POST";
    const response = await fetch("/api/catalogs", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id, ...item } : item),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || "Failed to save catalog item.");
    }
  }

  async function saveItem(item: Omit<ClinicalCatalogItem, "id">, id?: string) {
    await persistItem(item, id);
    await loadType(item.type);
  }

  async function deleteItem(id: string) {
    const response = await fetch(`/api/catalogs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || "Failed to delete catalog item.");
    }
    if (activeType !== "procedure") {
      await loadType(activeType);
    }
  }

  return (
    <div className={["space-y-4", className].filter(Boolean).join(" ")}>
      <Tabs value={activeType} onValueChange={(value) => setActiveType(value as CatalogManagerType)}>
        {visibleTypes.length > 1 && (
          <TabsList>
            {visibleTypes.map((type) => (
              <TabsTrigger key={type} value={type}>{type === "document" ? "Documents" : TYPE_LABELS[type]}</TabsTrigger>
            ))}
          </TabsList>
        )}
        {visibleTypes.map((type) => (
          <TabsContent key={type} value={type} className="mt-4 space-y-4">
            {type === "procedure" ? (
              procedureLoading ? (
                <div className="rounded-md border py-8 text-center text-sm text-muted-foreground">
                  Loading procedures...
                </div>
              ) : (
                <ProceduresTable
                  procedures={procedures}
                  searchTerm={procedureSearch}
                  onSearchChange={setProcedureSearch}
                  onCreate={async (data) => {
                    await createProcedure(data);
                    await loadProcedures();
                    toast({ title: "Procedure saved" });
                  }}
                  onUpdate={async (id, data) => {
                    await updateProcedure(id, data);
                    await loadProcedures();
                    toast({ title: "Procedure updated" });
                  }}
                  onDelete={async (id) => {
                    if (!window.confirm("Delete this procedure?")) return;
                    await deleteProcedure(id);
                    await loadProcedures();
                    toast({ title: "Procedure deleted" });
                  }}
                />
              )
            ) : (
              <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${TYPE_LABELS[type].toLowerCase()}`}
                  className="h-8 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add {TYPE_LABELS[type].replace(/s$/, "")}
              </Button>
            </div>
            <CatalogTable
              rows={filteredRows}
              loading={loading}
              deletingIds={deletingIds}
              onEdit={setEditing}
              onDelete={async (id) => {
                if (!window.confirm("Delete this catalog item?")) return;
                setDeletingIds((prev) => ({ ...prev, [id]: true }));
                try {
                  await deleteItem(id);
                  toast({ title: "Catalog item deleted" });
                } catch (error) {
                  toast({
                    title: "Delete failed",
                    description: error instanceof Error ? error.message : "Failed to delete catalog item.",
                    variant: "destructive",
                  });
                } finally {
                  setDeletingIds((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                }
              }}
            />
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {TYPE_LABELS[activeType].replace(/s$/, "")}</DialogTitle>
          </DialogHeader>
          <CatalogForm
            initial={{ ...EMPTY_FORM, type: clinicalType, system: defaultSystem(clinicalType) }}
            onCancel={() => setCreating(false)}
            onSubmit={async (item) => {
              try {
                await saveItem(item);
                setCreating(false);
                toast({ title: "Catalog item saved" });
              } catch (error) {
                toast({
                  title: "Save failed",
                  description: error instanceof Error ? error.message : "Failed to save catalog item.",
                  variant: "destructive",
                });
                throw error;
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => {
        if (!open) {
          setEditing(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Catalog Item</DialogTitle>
          </DialogHeader>
          {editing && (
            <CatalogForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onSubmit={async (item) => {
                try {
                  await saveItem(item, editing.id);
                  setEditing(null);
                  toast({ title: "Catalog item updated" });
                } catch (error) {
                  toast({
                    title: "Update failed",
                    description: error instanceof Error ? error.message : "Failed to update catalog item.",
                    variant: "destructive",
                  });
                  throw error;
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CatalogTable({
  rows,
  loading,
  deletingIds,
  onEdit,
  onDelete,
}: {
  rows: ClinicalCatalogItem[];
  loading: boolean;
  deletingIds: Record<string, boolean>;
  onEdit: (item: ClinicalCatalogItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[110px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                Loading catalog...
              </TableCell>
            </TableRow>
          ) : null}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                No catalog items found.
              </TableCell>
            </TableRow>
          ) : null}
          {!loading && rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>{item.code || "-"}</TableCell>
              <TableCell>
                {[item.category, item.modality].filter(Boolean).join(" / ") || "-"}
              </TableCell>
              <TableCell>RM {item.defaultPrice.toFixed(2)}</TableCell>
              <TableCell>
                <Badge variant={item.active ? "secondary" : "outline"}>{item.active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(item)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={deletingIds[item.id]} onClick={() => onDelete(item.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CatalogForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: Omit<ClinicalCatalogItem, "id"> | ClinicalCatalogItem;
  onSubmit: (item: Omit<ClinicalCatalogItem, "id">) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState<Omit<ClinicalCatalogItem, "id">>({
    type: initial.type,
    name: initial.name || "",
    code: initial.code || "",
    system: initial.system || "",
    display: initial.display || "",
    category: initial.category || "",
    modality: initial.modality || "",
    defaultPrice: initial.defaultPrice || 0,
    active: initial.active !== false,
    notes: initial.notes || "",
  });
  const [saving, setSaving] = React.useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await onSubmit({
            ...form,
            name: form.name.trim(),
            display: form.display?.trim() || form.name.trim(),
            code: form.code?.trim() || undefined,
            system: form.system?.trim() || undefined,
            category: form.category?.trim() || undefined,
            modality: form.modality?.trim() || undefined,
            notes: form.notes?.trim() || undefined,
            defaultPrice: Number(form.defaultPrice || 0),
          });
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Name</Label>
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </div>
        <div className="space-y-1">
          <Label>Display</Label>
          <Input value={form.display || ""} onChange={(event) => setForm({ ...form, display: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Code</Label>
          <Input value={form.code || ""} onChange={(event) => setForm({ ...form, code: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>System</Label>
          <Input value={form.system || ""} onChange={(event) => setForm({ ...form, system: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Category</Label>
          <Input value={form.category || ""} onChange={(event) => setForm({ ...form, category: event.target.value })} />
        </div>
        {form.type === "imaging" ? (
          <div className="space-y-1">
            <Label>Modality</Label>
            <Select value={form.modality || ""} onValueChange={(value) => setForm({ ...form, modality: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select modality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DX">DX</SelectItem>
                <SelectItem value="CT">CT</SelectItem>
                <SelectItem value="MR">MR</SelectItem>
                <SelectItem value="US">US</SelectItem>
                <SelectItem value="MG">MG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label>Default Price</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.defaultPrice}
            onChange={(event) => setForm({ ...form, defaultPrice: Number(event.target.value || 0) })}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <Label>Active</Label>
          <Switch checked={form.active} onCheckedChange={(checked) => setForm({ ...form, active: checked })} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Notes</Label>
        <Input value={form.notes || ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function defaultSystem(type: ClinicalCatalogType): string {
  if (type === "lab" || type === "imaging") return "http://loinc.org";
  return "https://ucc.emr/document-type";
}
