import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.OBJECT_STORAGE_ENDPOINT ?? "http://minio:9000";
const region = process.env.OBJECT_STORAGE_REGION ?? "us-east-1";
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY ?? "handoff";
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY ?? "handoff-local-secret";
const buckets = [
  process.env.OBJECT_STORAGE_BUCKET ?? "handoff",
  process.env.AUDIT_ANCHOR_BUCKET ?? "handoff-audit-anchors",
];

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function ensureBucket(bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`[storage-init] bucket exists: ${bucket}`);
    return;
  } catch {
    // Create below. MinIO returns a not-found style error for missing buckets.
  }

  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`[storage-init] bucket created: ${bucket}`);
}

for (const bucket of buckets) {
  await ensureBucket(bucket);
}
