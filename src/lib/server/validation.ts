import { z } from "zod";
import { RESOURCE_FIELDS, type ResourceValues } from "../resources";

export const weekSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1 &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}, "Choose a valid week starting on Monday.");

export const resourceSchema = z
  .object(
    Object.fromEntries(
      RESOURCE_FIELDS.map(({ key }) => [
        key,
        z.number().int().min(0).max(1_000_000_000).default(0),
      ]),
    ),
  )
  .strict()
  .transform((value) => value as ResourceValues);

export const saveResourcesSchema = z
  .object({
    week: weekSchema,
    memberId: z.string().uuid().optional(),
    resources: resourceSchema,
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();

export const copyResourcesSchema = z
  .object({ week: weekSchema, memberId: z.string().uuid().optional() })
  .strict();
export const updateMemberSchema = z
  .object({
    role: z.enum(["ADMIN", "MEMBER"]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.role !== undefined || value.active !== undefined,
    "Select a change to save.",
  );
