import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { AgentMetadata } from "./worker_pool.ts";

export type FileKey = "worker" | "client" | "client_map";

export interface BundleStore {
  putAgent(bundle: {
    slug: string;
    env: Record<string, string>;
    transport: ("websocket" | "twilio")[];
    worker: string;
    client: string;
    client_map?: string;
  }): Promise<void>;
  getManifest(slug: string): Promise<AgentMetadata | null>;
  getFile(slug: string, file: FileKey): Promise<string | null>;
  deleteAgent(slug: string): Promise<void>;
  close(): void;
  [Symbol.dispose](): void;
}

interface CacheEntry {
  data: string;
  etag: string;
}

const FILE_NAMES: Record<FileKey, string> = {
  worker: "worker.js",
  client: "client.js",
  client_map: "client.js.map",
};

function objectKey(slug: string, file: string): string {
  return `agents/${slug}/${file}`;
}

export function createS3Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: Deno.env.get("AWS_ENDPOINT_URL_S3"),
    credentials: {
      accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "",
    },
  });
}

export class TigrisBundleStore implements BundleStore {
  #s3: S3Client;
  #bucket: string;
  #cache = new Map<string, CacheEntry>();

  constructor(s3: S3Client, bucket: string) {
    this.#s3 = s3;
    this.#bucket = bucket;
  }

  async putAgent(bundle: {
    slug: string;
    env: Record<string, string>;
    transport: ("websocket" | "twilio")[];
    worker: string;
    client: string;
    client_map?: string;
  }): Promise<void> {
    await this.deleteAgent(bundle.slug);

    const manifest: AgentMetadata = {
      slug: bundle.slug,
      env: bundle.env,
      transport: bundle.transport,
    };
    await this.#put(
      objectKey(bundle.slug, "manifest.json"),
      JSON.stringify(manifest),
      "application/json",
    );

    await this.#put(
      objectKey(bundle.slug, "worker.js"),
      bundle.worker,
      "application/javascript",
    );

    await this.#put(
      objectKey(bundle.slug, "client.js"),
      bundle.client,
      "application/javascript",
    );

    if (bundle.client_map) {
      await this.#put(
        objectKey(bundle.slug, "client.js.map"),
        bundle.client_map,
        "application/json",
      );
    }
  }

  async getManifest(slug: string): Promise<AgentMetadata | null> {
    const data = await this.#get(objectKey(slug, "manifest.json"));
    if (data === null) return null;
    return JSON.parse(data) as AgentMetadata;
  }

  async getFile(slug: string, file: FileKey): Promise<string | null> {
    const fileName = FILE_NAMES[file];
    return await this.#get(objectKey(slug, fileName));
  }

  async deleteAgent(slug: string): Promise<void> {
    const prefix = `agents/${slug}/`;
    const listed = await this.#s3.send(
      new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: prefix,
      }),
    );

    const objects = listed.Contents;
    if (!objects || objects.length === 0) return;

    await this.#s3.send(
      new DeleteObjectsCommand({
        Bucket: this.#bucket,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key })),
        },
      }),
    );

    for (const o of objects) {
      if (o.Key) this.#cache.delete(o.Key);
    }
  }

  close(): void {
    // S3 client has no close
  }

  [Symbol.dispose](): void {
    this.close();
  }

  async #put(key: string, body: string, contentType: string): Promise<void> {
    const result = await this.#s3.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    if (result.ETag) {
      this.#cache.set(key, { data: body, etag: result.ETag });
    }
  }

  async #get(key: string): Promise<string | null> {
    const cached = this.#cache.get(key);

    try {
      const result = await this.#s3.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          ...(cached ? { IfNoneMatch: cached.etag } : {}),
        }),
      );

      const data = await result.Body!.transformToString();
      if (result.ETag) {
        this.#cache.set(key, { data, etag: result.ETag });
      }
      return data;
    } catch (err: unknown) {
      if (isS3Error(err, "304") || isS3Error(err, "NotModified")) {
        return cached!.data;
      }
      if (isS3Error(err, "NoSuchKey") || isS3Error(err, "404")) {
        return null;
      }
      throw err;
    }
  }
}

function isS3Error(err: unknown, codeOrStatus: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    e.name === codeOrStatus ||
    e.Code === codeOrStatus ||
    String(
        e.$metadata && (e.$metadata as Record<string, unknown>).httpStatusCode,
      ) === codeOrStatus
  );
}
