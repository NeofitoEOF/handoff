import crypto from "node:crypto";
import { config } from "./config.js";

const key = Buffer.from(config.INTEGRATION_ENCRYPTION_KEY, "hex");

export function decryptWebhookSecret(input: {
  ciphertext: string;
  iv: string;
  tag: string;
}): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);
  return clear.toString("utf8");
}

export async function sendSignedWebhook(input: {
  url: string;
  secret: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: input.eventId,
    type: input.eventType,
    createdAt: new Date().toISOString(),
    data: input.payload,
  });

  const signature = crypto
    .createHmac("sha256", input.secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "handoff-webhooks/1.0",
      "x-handoff-event": input.eventType,
      "x-handoff-event-id": input.eventId,
      "x-handoff-timestamp": timestamp,
      "x-handoff-signature": `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Webhook HTTP ${response.status}`);
  }
}
