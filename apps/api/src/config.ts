import { z } from "zod";

const envBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  OBJECT_STORAGE_ENDPOINT: z.string().url().default("http://localhost:9000"),
  OBJECT_STORAGE_REGION: z.string().default("us-east-1"),
  OBJECT_STORAGE_BUCKET: z.string().default("handoff"),
  AUDIT_ANCHOR_BUCKET: z.string().default("handoff-audit-anchors"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
  OBJECT_STORAGE_FORCE_PATH_STYLE: envBoolean.default(true),
  MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  PLATFORM_ADMIN_KEY: z.string().min(32),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  WEB_ORIGINS: z.string().default("http://localhost:5173"),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  CLAMAV_ENABLED: envBoolean.default(true),
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  METRICS_TOKEN: z.string().min(16).optional(),
});

export const config = envSchema.parse(process.env);
