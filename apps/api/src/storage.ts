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
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.OBJECT_STORAGE_BUCKET,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  );
}
