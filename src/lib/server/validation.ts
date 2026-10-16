import { z } from "zod";
import {
  LEGACY_EGGS_PETS_KEYS,
  MOUNT_SUMMON_COST_MIN,
  MOUNT_SUMMON_COST_MAX,
  SKILL_SUMMON_COST_MIN,
  SKILL_SUMMON_COST_MAX,
  RESOURCE_FIELDS,
  normalizeResources,
  resourceMaximum,
  skillCostHasValidPrecision,
} from "../resources";

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
      [
        ...RESOURCE_FIELDS.map(({ key }) => [
          key,
          key === "eggsPetsTotal"
            ? z.number().int().min(0).max(resourceMaximum(key)).optional()
            : z.number().int().min(0).max(resourceMaximum(key)).default(0),
        ]),
        ...LEGACY_EGGS_PETS_KEYS.map((key) => [
          key,
          z.number().int().min(0).max(1_000_000_000).optional(),
        ]),
        // Older open clients may still submit potions. Validate the retired
        // field, then omit it with the other legacy values during normalization.
        ["potions", z.number().int().min(0).max(1_000_000_000).optional()],
      ],
    ),
  )
  .strict()
  .transform(normalizeResources);

export const summoningCostsSchema = z
  .object({
    fiveSkills: z
      .number()
      .min(SKILL_SUMMON_COST_MIN)
      .max(SKILL_SUMMON_COST_MAX)
      .refine(
        skillCostHasValidPrecision,
        "Skill summon cost can have at most one decimal place.",
      ),
    mount: z.number().min(MOUNT_SUMMON_COST_MIN).max(MOUNT_SUMMON_COST_MAX),
  })
  .strict();

const extraChancePercent = z.number().min(0).max(1000).refine(
  value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Extra summon chance can have at most two decimal places.",
);
export const planningDetailsSchema = z.object({
  skillLevel: z.number().int().min(0).max(1_000_000_000).default(0),
  mountLevel: z.number().int().min(0).max(1_000_000_000).default(0),
  eggLevel: z.number().int().min(0).max(1_000_000_000).default(0),
  // Keep prior action counts readable and accepted from older open clients.
  newMountMerges: z.number().int().min(0).max(1_000_000).default(0),
  eggMerges: z.number().int().min(0).max(1_000_000).default(0),
  eggSummonMerges: z.number().int().min(0).max(1_000_000).default(0),
  extraMountChancePercent: extraChancePercent.optional(),
  extraPetSummonPercent: extraChancePercent.optional(),
  calculationVersion: z.literal(2).optional(),
}).strict();

const completeBankResourcesSchema = z.object(Object.fromEntries(
  RESOURCE_FIELDS.map(({ key }) => [key, z.number().int().min(0).max(resourceMaximum(key))]),
)).strict().transform(normalizeResources);

const completePlanningDetailsSchema = planningDetailsSchema.extend({
  skillLevel: z.number().int().min(0).max(1_000_000_000),
  mountLevel: z.number().int().min(0).max(1_000_000_000),
  eggLevel: z.number().int().min(0).max(1_000_000_000),
  extraMountChancePercent: extraChancePercent,
  extraPetSummonPercent: extraChancePercent,
  calculationVersion: z.literal(2).default(2),
});

export const saveBankSchema = z.object({
  memberId: z.string().uuid().optional(),
  resources: completeBankResourcesSchema,
  summoningCosts: summoningCostsSchema,
  planningDetails: completePlanningDetailsSchema,
  notes: z.string().trim().max(2000).default(""),
}).strict();

const pointRate = z.number().int().min(0).max(100_000);
export const warRatesSchema = z.object({
  hammersMin: pointRate, hammersMax: pointRate,
  skillSummons: pointRate, mountSummons: pointRate,
  newMountMerges: pointRate, mountMerges: pointRate,
  eggMerges: pointRate, eggSummonMerges: pointRate,
}).strict().refine(rates => rates.hammersMax >= rates.hammersMin, "The maximum hammer rate must be at least the minimum.");
export const settingsSchema = z.object({
  capacity: z.number().int().min(1).max(1000).optional(),
  warRates: warRatesSchema.optional(),
}).strict().refine(value => value.capacity !== undefined || value.warRates !== undefined, "Choose a setting to update.");
export const warActivitySchema = z.enum(["hammers", "skillSummons", "mountSummons", "newMountMerges", "mountMerges", "eggMerges", "eggSummonMerges"]);
const activitiesSchema = z.array(warActivitySchema).min(1).max(7).refine(values => new Set(values).size === values.length, "Select each activity only once.");
export const createSnipeSchema = z.object({
  title: z.string().trim().min(1).max(120),
  startsAt: z.string().datetime({ offset: true }),
  activities: activitiesSchema,
}).strict();
export const updateSnipeSchema = createSnipeSchema.partial().extend({ archived: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0, "Choose a change to save.");
export const snipeResponseSchema = z.object({ answer: z.enum(["yes", "no"]) }).strict();
export const purchaseDewSchema = z.object({ itemId: z.string().min(1).max(64) }).strict();
export const equipDewSchema = z.object({
  itemId: z.string().min(1).max(64).nullable(),
  category: z.enum(["badge", "title", "accent", "frame"]).optional(),
}).strict();
export const snipeAttendanceSchema = z.object({
  memberId: z.string().uuid(),
  attended: z.boolean(),
}).strict();

export const saveResourcesSchema = z
  .object({
    week: weekSchema,
    memberId: z.string().uuid().optional(),
    resources: resourceSchema,
    summoningCosts: summoningCostsSchema.optional(),
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
export const hoardingNoteSchema = z.object({
  memberId: z.string().uuid(),
  note: z.string().max(1000),
}).strict();
const screenshotSchema = z.object({
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  // Base64 only, at most about 1.5 MB per screenshot after the browser shrinks it.
  data: z.string().min(16).max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/),
}).strict();
export const recordKindSchema = z.enum(["war", "vials"]);
export const readWarSchema = z.object({ images: z.array(screenshotSchema).min(1).max(6), kind: recordKindSchema.optional() }).strict();
export const saveWarSchema = z.object({
  kind: recordKindSchema.optional(),
  week: weekSchema,
  label: z.string().max(120),
  clanTotal: z.number().int().min(0).max(1e15).nullable(),
  rows: z.array(z.object({
    gameName: z.string().trim().min(1).max(80),
    memberId: z.string().uuid().nullable(),
    points: z.number().int().min(0).max(1e15),
  }).strict()).max(200),
  images: z.array(screenshotSchema).max(6),
}).strict();
export const hoardingRulesSchema = z.object({
  largeMultiple: z.number().min(1).max(20),
  spendPercent: z.number().min(0).max(100),
  wars: z.number().int().min(1).max(10),
}).strict();
