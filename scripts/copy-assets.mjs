import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src", "renderer");
const targetRoot = path.join(root, "dist", "renderer");

await fs.mkdir(targetRoot, { recursive: true });
await copyDir(sourceRoot, targetRoot);

async function copyDir(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }

    if (entry.name.endsWith(".html") || entry.name.endsWith(".css")) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}
