"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { formatMalaysianDate, parseMalaysianDate, parseMalaysianNricDob } from "@/lib/patient-dob";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  nric: string;
  value?: string;
  onChange: (value: string) => void;
};

export function RegistrationDobInput({ nric, value = "", onChange, ...props }: Props) {
  const lastAuto = React.useRef<string | null>(null);
  const derived = parseMalaysianNricDob(nric);
  React.useEffect(() => {
    if (derived && (!value || value === lastAuto.current)) {
      lastAuto.current = derived;
      if (value !== derived) onChange(derived);
    }
  }, [derived, value, onChange]);

  return (
    <>
      <Input {...props} type="text" inputMode="numeric" placeholder="dd/mm/yyyy"
        value={formatMalaysianDate(value)}
        onChange={(event) => {
          lastAuto.current = null;
          onChange(parseMalaysianDate(event.target.value) ?? event.target.value);
        }} />
      {derived && value && value !== derived ? (
        <span role="status" className="block text-sm text-amber-700">
          Date of birth differs from NRIC ({formatMalaysianDate(derived)}). Please check.
        </span>
      ) : null}
    </>
  );
}
