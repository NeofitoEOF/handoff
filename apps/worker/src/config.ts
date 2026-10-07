import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  EMAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("Handoff <no-reply@localhost>"),
  WORKER_POLL_MS: z.coerce.number().int().min(5000).default(30000),
});

export const config = envSchema.parse(process.env);
