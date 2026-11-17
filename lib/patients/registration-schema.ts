import * as z from "zod";
import { isIsoDate } from "../patient-dob";

const PHONE_RE = /^\+?[0-9]{8,15}$/;

export const registrationFieldSchemas = {
  dateOfBirth: z
    .string()
    .refine(isIsoDate, "Enter a valid date as dd/mm/yyyy (filled automatically from the NRIC)"),
  gender: z.enum(["male", "female", "other"], { error: "Select a gender" }),
  phone: z
    .string()
    .min(1, "Enter a contact number")
    .regex(PHONE_RE, "Invalid phone number"),
};
