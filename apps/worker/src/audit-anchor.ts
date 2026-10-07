import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";

const storage = new S3Client({
  endpoint: config.OBJECT_STORAGE_ENDPOINT,
  region: config.OBJECT_STORAGE_REGION,
  forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
  },
});

export type AuditAnchorManifest = {
  version: 1;
  tenantId: string;
  anchorDate: string;
  chainSeq: number;
  chainHash: string;
  previousAnchorSha256: string | null;
};

export function buildAuditAnchorManifest(input: AuditAnchorManifest): {
  body: Buffer;
  sha256: string;
} {
  const canonical = JSON.stringify({
    version: input.version,
    tenantId: input.tenantId,
    anchorDate: input.anchorDate,
    chainSeq: input.chainSeq,
    chainHash: input.chainHash,
    previousAnchorSha256: input.previousAnchorSha256,
  });
  const body = Buffer.from(canonical + "\n", "utf8");
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");
  return { body, sha256 };
}

export async function storeAuditAnchor(input: {
  tenantId: string;
  anchorDate: string;
  chainSeq: number;
  chainHash: string;
  previousAnchorSha256: string | null;
}): Promise<{ bucket: string; key: string; manifestSha256: string }> {
  const manifest = buildAuditAnchorManifest({
    version: 1,
    tenantId: input.tenantId,
    anchorDate: input.anchorDate,
    chainSeq: input.chainSeq,
    chainHash: input.chainHash,
    previousAnchorSha256: input.previousAnchorSha256,
  });

  const key =
    `${input.tenantId}/${input.anchorDate}/anchor-${input.chainSeq}-${input.chainHash.slice(0, 16)}.json`;

  await storage.send(
    new PutObjectCommand({
      Bucket: config.AUDIT_ANCHOR_BUCKET,
      Key: key,
      Body: manifest.body,
      ContentType: "application/json",
      Metadata: {
        "chain-seq": String(input.chainSeq),
        "chain-hash": input.chainHash,
        "manifest-sha256": manifest.sha256,
      },
    }),
  );

  return {
    bucket: config.AUDIT_ANCHOR_BUCKET,
    key,
    manifestSha256: manifest.sha256,
  };
}
