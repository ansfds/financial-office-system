import { z } from 'zod';
export const dailyNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100000),
});
export const dailyNoteUpdateSchema = dailyNoteSchema.extend({ updatedAt: z.string().datetime() });
