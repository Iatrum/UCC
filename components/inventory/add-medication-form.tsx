"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Medication } from "@/lib/inventory";
import { MEDICATION_CATEGORIES } from "@/lib/constants";

interface AddMedicationFormProps {
  onSubmit: (data: Omit<Medication, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
}

type MedicationFormErrors = Partial<Record<"name" | "category" | "dosageForm" | "stock" | "minimumStock" | "unitPrice" | "expiryDate", string>>;

function validateMedicationForm(formData: FormData, category: string): MedicationFormErrors {
  const errors: MedicationFormErrors = {};

  if (!(formData.get("name") as string | null)?.trim()) {
    errors.name = "Medication name is required.";
  }

  if (!category) {
    errors.category = "Category is required.";
  }

  if (!(formData.get("dosageForm") as string | null)?.trim()) {
    errors.dosageForm = "Dosage form is required.";
  }

  if (!(formData.get("stock") as string | null)?.trim()) {
    errors.stock = "Initial stock is required.";
  }

  if (!(formData.get("minimumStock") as string | null)?.trim()) {
    errors.minimumStock = "Minimum stock level is required.";
  }

  if (!(formData.get("unitPrice") as string | null)?.trim()) {
    errors.unitPrice = "Unit price is required.";
  }

  if (!(formData.get("expiryDate") as string | null)?.trim()) {
    errors.expiryDate = "Expiry date is required.";
  }

  return errors;
}

export function AddMedicationForm({ onSubmit, onCancel }: AddMedicationFormProps) {
  const [category, setCategory] = React.useState("");
  const [errors, setErrors] = React.useState<MedicationFormErrors>({});

  const clearError = (field: keyof MedicationFormErrors) => {
    setErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const nextErrors = validateMedicationForm(formData, category);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    
    const medicationData = {
      name: (formData.get('name') as string).trim(),
      category,
      dosageForm: (formData.get('dosageForm') as string).trim(),
      strengths: [], // You'll need to handle this separately
      stock: parseInt(formData.get('stock') as string),
      minimumStock: parseInt(formData.get('minimumStock') as string),
      unit: 'units',
      expiryDate: formData.get('expiryDate') as string,
      unitPrice: parseFloat(formData.get('unitPrice') as string),
    };

    await onSubmit(medicationData);
    form.reset();
    setCategory("");
    setErrors({});
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Medication Name</Label>
          <Input
            id="name"
            name="name"
            placeholder="Enter medication name"
            required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
            onChange={() => clearError("name")}
          />
          {errors.name ? (
            <p id="name-error" role="alert" className="text-sm text-destructive">
              {errors.name}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              clearError("category");
            }}
            required
          >
            <SelectTrigger
              id="category"
              aria-invalid={Boolean(errors.category)}
              aria-describedby={errors.category ? "category-error" : undefined}
            >
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {MEDICATION_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category.toLowerCase()}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category ? (
            <p id="category-error" role="alert" className="text-sm text-destructive">
              {errors.category}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="dosageForm">Dosage Form</Label>
          <Input
            id="dosageForm"
            name="dosageForm"
            placeholder="Enter dosage form"
            required
            aria-invalid={Boolean(errors.dosageForm)}
            aria-describedby={errors.dosageForm ? "dosageForm-error" : undefined}
            onChange={() => clearError("dosageForm")}
          />
          {errors.dosageForm ? (
            <p id="dosageForm-error" role="alert" className="text-sm text-destructive">
              {errors.dosageForm}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="stock">Initial Stock</Label>
          <Input
            id="stock"
            name="stock"
            type="number"
            min="0"
            placeholder="Enter initial stock"
            required
            aria-invalid={Boolean(errors.stock)}
            aria-describedby={errors.stock ? "stock-error" : undefined}
            onChange={() => clearError("stock")}
          />
          {errors.stock ? (
            <p id="stock-error" role="alert" className="text-sm text-destructive">
              {errors.stock}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="minimumStock">
            Minimum Stock Level
            <span className="text-sm text-muted-foreground ml-1">
              (Alert when stock is below this)
            </span>
          </Label>
          <Input
            id="minimumStock"
            name="minimumStock"
            type="number"
            min="0"
            placeholder="Enter minimum stock level"
            required
            aria-invalid={Boolean(errors.minimumStock)}
            aria-describedby={errors.minimumStock ? "minimumStock-error" : undefined}
            onChange={() => clearError("minimumStock")}
          />
          {errors.minimumStock ? (
            <p id="minimumStock-error" role="alert" className="text-sm text-destructive">
              {errors.minimumStock}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="unitPrice">Unit Price (RM)</Label>
          <Input
            id="unitPrice"
            name="unitPrice"
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter unit price"
            required
            aria-invalid={Boolean(errors.unitPrice)}
            aria-describedby={errors.unitPrice ? "unitPrice-error" : undefined}
            onChange={() => clearError("unitPrice")}
          />
          {errors.unitPrice ? (
            <p id="unitPrice-error" role="alert" className="text-sm text-destructive">
              {errors.unitPrice}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiryDate">Expiry Date</Label>
          <Input
            id="expiryDate"
            name="expiryDate"
            type="date"
            required
            aria-invalid={Boolean(errors.expiryDate)}
            aria-describedby={errors.expiryDate ? "expiryDate-error" : undefined}
            onChange={() => clearError("expiryDate")}
          />
          {errors.expiryDate ? (
            <p id="expiryDate-error" role="alert" className="text-sm text-destructive">
              {errors.expiryDate}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Medication</Button>
      </div>
    </form>
  );
}
