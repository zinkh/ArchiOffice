// Validates POST/PUT /api/invoices bodies. Fields are optional/nullable to
// match the route's own existing defaults (`amount || 0`, `due_date || null`,
// etc. — see server.ts) rather than newly requiring anything the routes
// didn't already require; the value added here is type/shape correctness
// (an `amount` that isn't a number, a `status` outside the real enum, a
// negative quantity) rather than new required-field rules. Unknown keys on
// the body (e.g. `id`, `project_name`, `superpdp_id` — the frontend sends
// the full Invoice object on save) are left alone: Zod's default object
// mode strips them from the parsed output without failing validation, and
// this middleware never consumes that output anyway (see validateRequest.ts).
import { z } from 'zod';

export const invoiceItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().nonnegative('quantity must be >= 0'),
  unit_price: z.number(),
  vat_rate: z.number().min(0).max(100),
});

export const invoiceSchema = z.object({
  project_id: z.string().optional().nullable(),
  amount: z.number().optional(),
  description: z.string().optional(),
  status: z.enum(['Draft', 'Sent', 'Paid', 'Overdue']).optional(),
  due_date: z.string().optional().nullable(),
  issue_date: z.string().optional().nullable(),
  invoice_number: z.string().optional().nullable(),
  tax_amount: z.number().optional(),
  total_amount: z.number().optional(),
  seller_name: z.string().optional().nullable(),
  seller_address: z.string().optional().nullable(),
  seller_siret: z.string().optional().nullable(),
  seller_vat_number: z.string().optional().nullable(),
  seller_iban: z.string().optional().nullable(),
  seller_bic: z.string().optional().nullable(),
  vat_rate: z.number().min(0).max(100).optional(),
  invoice_type: z.enum(['standard', 'acompte']).optional(),
  mission_id: z.string().optional().nullable(),
  mission_name: z.string().optional().nullable(),
  advancement_pct: z.number().optional(),
  affaire_invoice_number: z.string().optional().nullable(),
  phases: z.array(z.object({
    phase_id: z.string(),
    phase_name: z.string(),
    avancement_pct: z.number().min(0).max(100),
    montant_phase: z.number(),
  })).optional(),
  items: z.array(invoiceItemSchema).optional(),
});
