import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import { MODEL_CATALOG, WhisperModel } from "../../shared/types";
import { resolveBundledFile } from "./runtimeAssetPaths";

const MIN_MODEL_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

export class ModelManager {
  readonly catalog = MODEL_CATALOG;

  async isInstalled(modelId: string): Promise<boolean> {
    const model = this.getModel(modelId);
    if (!model) {
      return false;
    }

    const target = this.localPath(model);
    if (!fs.existsSync(target)) {
      return false;
    }

    try {
      const stat = await fsp.stat(target);
      return stat.size >= MIN_MODEL_BYTES;
    } catch {
      return false;
    }
  }

  async installedModels(): Promise<WhisperModel[]> {
    const checks = await Promise.all(this.catalog.map((model) => this.isInstalled(model.id)));
    return this.catalog.filter((_, idx) => checks[idx]);
  }

  async downloadModel(modelId: string, onProgress?: (percent: number) => void): Promise<void> {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    const destination = this.localPath(model);
    const temporaryFile = `${destination}.download`;

    await fsp.mkdir(path.dirname(destination), { recursive: true });
    if (await this.isInstalled(model.id)) {
      throw new Error("Model already installed");
    }

    const bundledSource = await this.resolveBundledModelPath(model);
    if (bundledSource) {
      await fsp.copyFile(bundledSource, destination);
      if (onProgress) {
        onProgress(100);
      }
      return;
    }

    await fsp.rm(temporaryFile, { force: true });

    await this.downloadToFile(model.downloadUrl, temporaryFile, MAX_REDIRECTS, onProgress).catch(async (error) => {
      await fsp.rm(temporaryFile, { force: true });
      throw error;
    });

    const stat = await fsp.stat(temporaryFile);
    if (stat.size < MIN_MODEL_BYTES) {
      await fsp.rm(temporaryFile, { force: true });
      throw new Error("Downloaded model file is invalid");
    }

    await fsp.rename(temporaryFile, destination);

    if (onProgress) {
      onProgress(100);
    }
  }

  async removeModel(modelId: string): Promise<void> {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    const target = this.localPath(model);
    if (!fs.existsSync(target)) {
      throw new Error("Model is not installed");
    }

    await fsp.rm(target);
  }

  async resolveModelPath(modelId: string): Promise<string> {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error("Model not found");
    }

    const target = this.localPath(model);
    if (await this.isInstalled(modelId)) {
      return target;
    }

    const bundledSource = await this.resolveBundledModelPath(model);
    if (!bundledSource) {
      throw new Error("Model is not installed");
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(bundledSource, target);
    return target;
  }

  async ensureBundledModel(modelId: string): Promise<boolean> {
    const model = this.getModel(modelId);
    if (!model) {
      return false;
    }

    if (await this.isInstalled(modelId)) {
      return true;
    }

    const bundledSource = await this.resolveBundledModelPath(model);
    if (!bundledSource) {
      return false;
    }

    const target = this.localPath(model);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(bundledSource, target);
    return true;
  }

  private async downloadToFile(
    urlString: string,
    destination: string,
    redirectsRemaining: number,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = https.get(urlString, (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          if (redirectsRemaining <= 0) {
            reject(new Error("Too many redirects while downloading model"));
            return;
          }

          const redirectedURL = new URL(response.headers.location, urlString).toString();
          response.resume();
          void this.downloadToFile(redirectedURL, destination, redirectsRemaining - 1, onProgress)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Download failed (${statusCode})`));
          return;
        }

        const total = Number(response.headers["content-length"] ?? 0);
        let received = 0;
        const file = fs.createWriteStream(destination, { flags: "w" });

        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0 && onProgress) {
            onProgress(Math.round((received / total) * 100));
          }
        });

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve();
        });

        file.on("error", reject);
      });

      request.on("error", reject);
    });
  }

  private getModel(modelId: string): WhisperModel | undefined {
    return this.catalog.find((model) => model.id === modelId);
  }

  private async resolveBundledModelPath(model: WhisperModel): Promise<string | undefined> {
    return resolveBundledFile(MIN_MODEL_BYTES, "models", model.fileName);
  }

  private localPath(model: WhisperModel): string {
    return path.join(app.getPath("userData"), "Models", model.fileName);
  }
}
