// Validates POST/PUT /api/proposals bodies. The `Proposal` type (src/types.ts)
// has ~90 mostly-optional fields (site/client/building address details, MAF
// insurance fields, XML import fields, ...) built up incrementally over the
// life of the feature — mirroring all of them here would itself become a
// second place for that shape to drift out of sync. This schema instead
// type-checks the fields that actually drive business logic downstream
// (amount, status, VAT rate, specialties) and leaves the long tail of
// free-form string fields unvalidated: Zod's default object mode doesn't
// reject unknown keys, so those still pass through untouched.
import { z } from 'zod';

// Les champs facultatifs acceptent aussi `null` : le formulaire renvoie la
// proposition telle qu'elle a été lue en base, où une description ou un taux
// de TVA jamais renseignés valent NULL. Les refuser rendait toute
// modification de ces propositions impossible (« Validation error »).
export const proposalSpecialtySchema = z.object({
  id: z.string().optional().nullable(),
  specialty_name: z.string(),
  contact_id: z.string().optional().nullable(),
});

export const proposalSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional().nullable(),
  client_id: z.string().optional().nullable(),
  amount: z.number().optional().nullable(),
  status: z.enum(['Draft', 'Sent', 'Accepted', 'Rejected']).optional(),
  description: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  is_entreprise: z.boolean().optional().nullable(),
  vat_rate: z.number().min(0).max(100).optional().nullable(),
  specialties_list: z.array(proposalSpecialtySchema).optional().nullable(),
});
