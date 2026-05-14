import { z } from 'zod';

const MACHINE_BLOCK_SCHEMA_VERSION = 1;

const overridesSchema = z
  .object({
    max_files_changed: z.number().int().positive().optional(),
    retry_budget: z.number().int().nonnegative().optional(),
    time_budget_minutes: z.number().int().positive().optional(),
  })
  .strict();

export const MachineBlockSchema = z
  .object({
    schemaVersion: z.literal(MACHINE_BLOCK_SCHEMA_VERSION),
    repo: z.string().min(1),
    context_refs: z.array(z.string()),
    adr_refs: z.array(z.string()),
    prd_refs: z.array(z.string()),
    validator_commands: z.array(z.string()),
    overrides: overridesSchema.optional(),
    notes_for_worker: z.array(z.string()).optional(),
  })
  .strict();

export type MachineBlock = z.infer<typeof MachineBlockSchema>;
export type MachineBlockOverrides = z.infer<typeof overridesSchema>;

export { MACHINE_BLOCK_SCHEMA_VERSION };
