import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

const client = new S3Client({
  endpoint: config.OBJECT_STORAGE_ENDPOINT,
  region: config.OBJECT_STORAGE_REGION,
  forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
  },
});

export async function putObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: config.OBJECT_STORAGE_BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
  }));
}


export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  return getPresignedDownloadUrlForBucket(
    config.OBJECT_STORAGE_BUCKET,
    key,
    expiresInSeconds,
  );
}

export async function getPresignedDownloadUrlForBucket(
  bucket: string,
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function getObjectBuffer(
  bucket: string,
  key: string,
): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error("Object storage returned an empty body.");
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}
