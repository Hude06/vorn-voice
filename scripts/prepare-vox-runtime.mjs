import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import https from "node:https";

const root = process.cwd();
const runtimeRoot = path.join(root, "build", "runtime");
const runtimeDir = path.join(runtimeRoot, "bin");
const runtimeLibDir = path.join(runtimeRoot, "lib");
const modelsDir = path.join(runtimeRoot, "models");
const manifestPath = path.join(runtimeRoot, "runtime-manifest.json");
const modelCatalogPath = path.join(root, "src", "shared", "modelCatalog.json");
const MAX_REDIRECTS = 5;

const modelCatalog = JSON.parse(await fs.readFile(modelCatalogPath, "utf8"));
const bundledModels = resolveBundledModels(modelCatalog);

await fs.mkdir(runtimeDir, { recursive: true });
await fs.rm(runtimeLibDir, { recursive: true, force: true });
await fs.mkdir(runtimeLibDir, { recursive: true });
await fs.rm(modelsDir, { recursive: true, force: true });
await fs.mkdir(modelsDir, { recursive: true });

const binaries = [
  {
    targetName: "whisper-cli",
    envKeys: ["VOX_RUNTIME_PATH", "WHISPER_CLI_PATH"],
    fixedCandidates: [
      "/opt/homebrew/opt/whisper-cpp/bin/whisper-cli",
      "/usr/local/opt/whisper-cpp/bin/whisper-cli",
      "/opt/homebrew/bin/whisper-cli",
      "/usr/local/bin/whisper-cli"
    ],
    shellExecutable: "whisper-cli",
    missingMessage: "Unable to locate whisper-cli to bundle VOX runtime. Install whisper-cpp with Homebrew or set VOX_RUNTIME_PATH to a whisper-cli executable."
  },
  {
    targetName: "sox",
    envKeys: ["VOX_SOX_PATH", "SOX_PATH"],
    fixedCandidates: ["/opt/homebrew/bin/sox", "/usr/local/bin/sox"],
    shellExecutable: "sox",
    missingMessage: "Unable to locate SoX to bundle the recorder runtime. Install SoX with Homebrew or set VOX_SOX_PATH to a sox executable."
  }
];

const manifest = { binaries: [], libraries: [], models: [] };
let whisperSourcePath;

for (const binary of binaries) {
  const sourcePath = await resolveExecutablePath(binary.envKeys, binary.fixedCandidates, binary.shellExecutable);
  if (!sourcePath) {
    throw new Error(binary.missingMessage);
  }

  const bundledRuntimePath = path.join(runtimeDir, binary.targetName);
  await fs.copyFile(sourcePath, bundledRuntimePath);
  await fs.chmod(bundledRuntimePath, 0o755);

  if (binary.targetName === "whisper-cli") {
    whisperSourcePath = sourcePath;
  }

  manifest.binaries.push({
    name: binary.targetName,
    sourcePath,
    sha256: await sha256File(sourcePath)
  });

  process.stdout.write(`Bundled runtime binary ${binary.targetName} from ${sourcePath}\n`);
}

if (whisperSourcePath) {
  const libraries = await bundleWhisperLibraries(whisperSourcePath, runtimeLibDir);
  manifest.libraries.push(...libraries);
}

for (const model of bundledModels) {
  const bundledModelPath = path.join(modelsDir, model.fileName);
  await fs.rm(`${bundledModelPath}.download`, { force: true });
  await downloadToFile(model.downloadUrl, `${bundledModelPath}.download`, MAX_REDIRECTS);
  await fs.rename(`${bundledModelPath}.download`, bundledModelPath);

  manifest.models.push({
    id: model.id,
    fileName: model.fileName,
    downloadUrl: model.downloadUrl,
    sha256: await sha256File(bundledModelPath)
  });

  process.stdout.write(`Bundled speech model ${model.id} into ${bundledModelPath}\n`);
}

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

async function resolveExecutablePath(envKeys, fixedCandidates, shellExecutable) {
  const envCandidates = envKeys.map((key) => process.env[key]).filter(Boolean);

  for (const candidate of [...envCandidates, ...fixedCandidates]) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  const shellResolved = await resolveFromShell(shellExecutable);
  if (shellResolved && (await isExecutable(shellResolved))) {
    return shellResolved;
  }

  return undefined;
}

function resolveBundledModels(config) {
  const bundledModelIds = Array.isArray(config?.bundledModelIds) ? config.bundledModelIds : [];
  const models = Array.isArray(config?.models) ? config.models : [];
  const defaultModelId = typeof config?.defaultModelId === "string" ? config.defaultModelId : "";

  if (!bundledModelIds.includes(defaultModelId)) {
    throw new Error(`Default model ${defaultModelId || "<missing>"} must be bundled for packaged first run`);
  }

  return bundledModelIds.map((modelId) => {
    const model = models.find((candidate) => candidate.id === modelId);
    if (!model) {
      throw new Error(`Bundled model ${modelId} is missing from ${modelCatalogPath}`);
    }

    return {
      id: model.id,
      fileName: model.fileName,
      downloadUrl: model.downloadUrl
    };
  });
}

async function isExecutable(candidate) {
  try {
    await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromShell(executable) {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    const child = spawn(shell, ["-lic", `command -v ${executable}`], { stdio: ["ignore", "pipe", "ignore"] });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });

    child.on("error", () => resolve(undefined));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }

      const resolved = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      resolve(resolved);
    });
  });
}

async function sha256File(filePath) {
  const contents = await fs.readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function downloadToFile(urlString, destination, redirectsRemaining) {
  await new Promise((resolve, reject) => {
    const request = https.get(urlString, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        if (redirectsRemaining <= 0) {
          reject(new Error("Too many redirects while downloading bundled model"));
          return;
        }

        const redirectedUrl = new URL(response.headers.location, urlString).toString();
        response.resume();
        void downloadToFile(redirectedUrl, destination, redirectsRemaining - 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`Model download failed (${statusCode})`));
        return;
      }

      const file = createWriteStream(destination, { flags: "w" });
      response.pipe(file);

      file.on("finish", () => {
        file.close();
        resolve(undefined);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function bundleWhisperLibraries(whisperBinaryPath, destinationDir) {
  const bundledLibraries = [];
  const discovered = await collectDependencies([whisperBinaryPath], whisperBinaryPath);

  for (const dependency of discovered.values()) {
    const destinationPath = path.join(destinationDir, dependency.name);
    await fs.copyFile(dependency.sourcePath, destinationPath);
    await fs.chmod(destinationPath, 0o755);

    bundledLibraries.push({
      name: dependency.name,
      sourcePath: dependency.sourcePath,
      sha256: await sha256File(destinationPath)
    });

    process.stdout.write(`Bundled runtime library ${dependency.name} from ${dependency.sourcePath}\n`);
  }

  return bundledLibraries.sort((a, b) => a.name.localeCompare(b.name));
}

async function collectDependencies(entryPaths, executablePath) {
  const pending = [...entryPaths];
  const visitedFiles = new Set();
  const dependencies = new Map();

  while (pending.length > 0) {
    const currentPath = pending.pop();
    const realCurrentPath = await fs.realpath(currentPath).catch(() => currentPath);
    if (visitedFiles.has(realCurrentPath)) {
      continue;
    }
    visitedFiles.add(realCurrentPath);

    const linkedLibraries = await readLinkedLibraries(currentPath);
    for (const linkedLibrary of linkedLibraries) {
      if (isSystemLibrary(linkedLibrary)) {
        continue;
      }

      const resolved = await resolveLinkedLibraryPath(linkedLibrary, currentPath, executablePath);
      if (!resolved) {
        process.stderr.write(`Skipping unresolved runtime dependency ${linkedLibrary} (from ${currentPath})\n`);
        continue;
      }

      const realResolvedPath = await fs.realpath(resolved).catch(() => resolved);
      if (realResolvedPath === realCurrentPath) {
        continue;
      }

      const name = libraryName(linkedLibrary);
      if (!dependencies.has(name)) {
        dependencies.set(name, {
          name,
          sourcePath: resolved
        });
      }

      pending.push(resolved);
    }
  }

  return dependencies;
}

async function readLinkedLibraries(filePath) {
  const command = await runCommand("otool", ["-L", filePath]);
  if (command.code !== 0) {
    throw new Error(`Failed to inspect runtime dependencies for ${filePath}: ${command.stderr || command.stdout}`);
  }

  return command.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(" ")[0])
    .filter(Boolean);
}

function isSystemLibrary(libraryPath) {
  return (
    libraryPath.startsWith("/usr/lib/") ||
    libraryPath.startsWith("/System/Library/") ||
    libraryPath.startsWith("/System/iOSSupport/")
  );
}

async function resolveLinkedLibraryPath(linkedLibrary, originPath, executablePath) {
  const resolvedCandidates = [];
  const originDir = path.dirname(originPath);

  if (linkedLibrary.startsWith("/")) {
    resolvedCandidates.push(linkedLibrary);
  } else if (linkedLibrary.startsWith("@rpath/")) {
    const name = libraryName(linkedLibrary);
    resolvedCandidates.push(
      path.join(originDir, name),
      path.join(originDir, "..", "lib", name),
      path.join(path.dirname(executablePath), "..", "lib", name),
      path.join("/opt/homebrew/opt/whisper-cpp/libexec/lib", name),
      path.join("/opt/homebrew/lib", name),
      path.join("/usr/local/lib", name)
    );
  } else if (linkedLibrary.startsWith("@loader_path/")) {
    const relative = linkedLibrary.slice("@loader_path/".length);
    resolvedCandidates.push(path.join(originDir, relative));
  } else if (linkedLibrary.startsWith("@executable_path/")) {
    const relative = linkedLibrary.slice("@executable_path/".length);
    resolvedCandidates.push(path.join(path.dirname(executablePath), relative));
  }

  for (const candidate of resolvedCandidates) {
    try {
      await fs.access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function libraryName(linkedLibrary) {
  if (linkedLibrary.startsWith("@rpath/")) {
    return linkedLibrary.slice("@rpath/".length);
  }

  if (linkedLibrary.startsWith("@loader_path/")) {
    return path.basename(linkedLibrary);
  }

  if (linkedLibrary.startsWith("@executable_path/")) {
    return path.basename(linkedLibrary);
  }

  return path.basename(linkedLibrary);
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      resolve({ code: -1, stdout, stderr: stderr || error.message });
    });
    child.on("exit", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
