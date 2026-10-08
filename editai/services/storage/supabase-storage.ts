import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignedUpload, StorageProvider } from "@/types/services";

/** StorageProvider sobre Supabase Storage (bucket privado). */
export class SupabaseStorageProvider implements StorageProvider {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  private get store() {
    return this.client.storage.from(this.bucket);
  }

  async createSignedUploadUrl(path: string): Promise<SignedUpload> {
    const { data, error } = await this.store.createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(`Falha ao gerar URL de upload: ${error?.message}`);
    return { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.store.createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Falha ao assinar URL: ${error?.message}`);
    return data.signedUrl;
  }

  async createSignedUrls(paths: string[], expiresInSeconds: number): Promise<Record<string, string>> {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return {};
    const { data, error } = await this.store.createSignedUrls(unique, expiresInSeconds);
    if (error || !data) throw new Error(`Falha ao assinar URLs: ${error?.message}`);
    return Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
  }

  async exists(path: string): Promise<{ exists: boolean; sizeBytes: number | null }> {
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await this.store.list(dir, { search: name, limit: 10 });
    if (error) throw new Error(`Falha ao consultar storage: ${error.message}`);
    const file = data?.find((f) => f.name === name);
    const size = (file?.metadata as { size?: number } | undefined)?.size;
    return { exists: Boolean(file), sizeBytes: typeof size === "number" ? size : null };
  }

  async downloadToFile(path: string, localPath: string): Promise<void> {
    // URL assinada + streaming: não carrega vídeos inteiros na memória.
    const url = await this.createSignedUrl(path, 600);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${path}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(localPath));
  }

  async downloadBuffer(path: string): Promise<ArrayBuffer> {
    const { data, error } = await this.store.download(path);
    if (error || !data) throw new Error(`Falha ao baixar ${path}: ${error?.message}`);
    return data.arrayBuffer();
  }

  async uploadFile(path: string, localPath: string, contentType: string): Promise<void> {
    // TODO: para arquivos > 50 MB, usar upload resumível (TUS) do Supabase.
    const body = await readFile(localPath);
    const { error } = await this.store.upload(path, body, { contentType, upsert: true });
    if (error) throw new Error(`Falha ao enviar ${path}: ${error.message}`);
  }

  async remove(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.store.remove(paths);
    if (error) throw new Error(`Falha ao remover arquivos: ${error.message}`);
  }

  async removePrefix(prefix: string): Promise<void> {
    const files = await this.listRecursive(prefix);
    for (let i = 0; i < files.length; i += 100) await this.remove(files.slice(i, i + 100));
  }

  private async listRecursive(prefix: string): Promise<string[]> {
    const { data, error } = await this.store.list(prefix, { limit: 1000 });
    if (error || !data) return [];
    const out: string[] = [];
    for (const entry of data) {
      const full = `${prefix}/${entry.name}`;
      if (entry.id) out.push(full);
      else out.push(...(await this.listRecursive(full)));
    }
    return out;
  }
}
