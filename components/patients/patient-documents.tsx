"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";

type PatientDocument = {
  id: string;
  title: string;
  contentType?: string;
  size?: number;
  url: string;
  uploadedAt?: Date | string | null;
  uploadedBy?: string | null;
  storagePath?: string; // used only client-side for bucket deletion
};

interface Props {
  patientId: string;
}

export default function PatientDocuments({ patientId }: Props) {
  const [docs, setDocs] = useState<PatientDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchDocs = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/documents?patientId=${encodeURIComponent(patientId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to load documents");
      }
      const data = await res.json();
      const items: PatientDocument[] = (data.documents || []).map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        contentType: doc.contentType,
        size: doc.size,
        uploadedAt: doc.uploadedAt,
        uploadedBy: doc.uploadedBy,
        storagePath: doc.storagePath,
      }));
      setDocs(items);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Unable to load documents", description: err?.message || "Please try again", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [patientId, toast]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const onSelectFiles: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const storage = getStorage();
    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf") {
          toast({ title: "Invalid file", description: `${file.name} is not a PDF`, variant: "destructive" });
          continue;
        }
        const path = `patients/${patientId}/documents/${Date.now()}-${file.name}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, file, { contentType: file.type });
        const url = await getDownloadURL(ref);

        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId,
            title: file.name,
            contentType: file.type,
            size: file.size,
            url,
            storagePath: path,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to register document in FHIR');
        }
      }
      toast({ title: "Upload complete" });
      fetchDocs();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Upload failed", description: err?.message || "Please try again", variant: "destructive" });
    } finally {
      setUploading(false);
      e.currentTarget.value = ""; // reset input
    }
  };

  const onDelete = async (docItem: PatientDocument) => {
    const ok = confirm(`Delete ${docItem.title}? This cannot be undone.`);
    if (!ok) return;
    try {
      // Delete from Storage
      const storage = getStorage();
      if (docItem.storagePath) {
        await deleteObject(storageRef(storage, docItem.storagePath));
      }
      // Delete DocumentReference in Medplum
      const res = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docItem.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to delete document');
      }
      setDocs((prev) => prev.filter((d) => d.id !== docItem.id));
      toast({ title: "Document deleted" });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Delete failed", description: err?.message || "Please try again", variant: "destructive" });
    }
  };

  const formatDate = (v?: Date | string | null) => {
    if (!v) return "-";
    const d = typeof v === "string" ? new Date(v) : v;
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  };

  const totalSize = useMemo(() => docs.reduce((a, b) => a + (b.size || 0), 0), [docs]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <div className="flex items-center gap-2">
          <label htmlFor="pdf-upload">
            <input
              id="pdf-upload"
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={onSelectFiles}
            />
            <Button asChild variant="default" disabled={uploading}>
              <span className="inline-flex items-center">
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploading ? "Uploading..." : "Upload PDF"}
              </span>
            </Button>
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading documents...</div>
        ) : docs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No documents uploaded.</div>
        ) : (
          <div className="relative border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <div className="inline-flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <a className="hover:underline" href={d.url} target="_blank" rel="noreferrer">
                          {d.title}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(d.uploadedAt)}</TableCell>
                    <TableCell>{d.size ? `${(d.size / 1024 / 1024).toFixed(2)} MB` : '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button asChild variant="outline" size="sm">
                          <a href={d.url} target="_blank" rel="noreferrer">View</a>
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => onDelete(d)}>
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
      </CardContent>
    </Card>
  );
}
