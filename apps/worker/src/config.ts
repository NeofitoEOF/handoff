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
  GOTENBERG_URL: z.string().url().default("http://localhost:3001"),
  OBJECT_STORAGE_ENDPOINT: z.string().url().default("http://localhost:9000"),
  OBJECT_STORAGE_REGION: z.string().default("us-east-1"),
  OBJECT_STORAGE_BUCKET: z.string().default("handoff"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
  OBJECT_STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
});

export const config = envSchema.parse(process.env);
