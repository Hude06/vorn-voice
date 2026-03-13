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
const downloadsDir = path.join(runtimeRoot, ".downloads");
const stagingDir = path.join(runtimeRoot, ".staging");
const modelCatalogPath = path.join(root, "src", "shared", "modelCatalog.json");
const windowsRuntimeAssetManifestPath = path.join(root, "scripts", "windows-runtime-assets.win32-x64.json");
const MAX_REDIRECTS = 5;
const targetPlatform = process.env.VOX_RUNTIME_TARGET || process.platform;
const isWindowsTarget = targetPlatform === "win32";
const isDarwinTarget = targetPlatform === "darwin";
const useSystemWindowsRuntime = process.env.VOX_USE_SYSTEM_WINDOWS_RUNTIME === "1";

const modelCatalog = JSON.parse(await fs.readFile(modelCatalogPath, "utf8"));
const bundledModels = resolveBundledModels(modelCatalog);

await fs.mkdir(runtimeRoot, { recursive: true });
await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.mkdir(runtimeDir, { recursive: true });
await fs.rm(runtimeLibDir, { recursive: true, force: true });
await fs.mkdir(runtimeLibDir, { recursive: true });
await fs.rm(modelsDir, { recursive: true, force: true });
await fs.mkdir(modelsDir, { recursive: true });
await fs.rm(stagingDir, { recursive: true, force: true });
await fs.mkdir(stagingDir, { recursive: true });
await fs.mkdir(downloadsDir, { recursive: true });

const manifest = { binaries: [], downloads: [], libraries: [], models: [], supportFiles: [] };
const recordedDownloads = new Set();

try {
  if (isWindowsTarget) {
    await bundleWindowsRuntime(manifest, recordedDownloads);
  } else {
    await bundleStandardRuntime(manifest);
  }

  for (const model of bundledModels) {
    const bundledModelPath = path.join(modelsDir, model.fileName);
    await fs.rm(`${bundledModelPath}.download`, { force: true });
    await downloadToFile(model.downloadUrl, `${bundledModelPath}.download`, MAX_REDIRECTS, "bundled model");
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
} finally {
  await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
}

async function bundleStandardRuntime(manifest) {
  const binaries = [
    {
      targetName: executableFileName("whisper-cli"),
      envKeys: ["VOX_RUNTIME_PATH", "WHISPER_CLI_PATH"],
      fixedCandidates: isDarwinTarget
        ? [
          "/opt/homebrew/opt/whisper-cpp/bin/whisper-cli",
          "/usr/local/opt/whisper-cpp/bin/whisper-cli",
          "/opt/homebrew/bin/whisper-cli",
          "/usr/local/bin/whisper-cli"
        ]
        : [],
      shellExecutable: executableFileName("whisper-cli"),
      missingMessage: "Unable to locate whisper-cli to bundle the speech runtime. Set VOX_RUNTIME_PATH to a whisper-cli executable or make it available on PATH."
    },
    {
      targetName: executableFileName("sox"),
      envKeys: ["VOX_SOX_PATH", "SOX_PATH"],
      fixedCandidates: isDarwinTarget ? ["/opt/homebrew/bin/sox", "/usr/local/bin/sox"] : [],
      shellExecutable: executableFileName("sox"),
      missingMessage: "Unable to locate SoX to bundle the recorder runtime. Set VOX_SOX_PATH to a sox executable or make it available on PATH."
    }
  ];

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
      sha256: await sha256File(bundledRuntimePath)
    });

    process.stdout.write(`Bundled runtime binary ${binary.targetName} from ${sourcePath}\n`);
  }

  if (isDarwinTarget && whisperSourcePath) {
    const libraries = await bundleWhisperLibraries(whisperSourcePath, runtimeLibDir);
    manifest.libraries.push(...libraries);
  }
}

async function bundleWindowsRuntime(manifest, recordedDownloads) {
  const assetManifest = JSON.parse(await fs.readFile(windowsRuntimeAssetManifestPath, "utf8"));
  const archivesById = new Map(assetManifest.archives.map((archive) => [archive.id, archive]));
  const stagedArchives = new Set();
  const stagedSupportFiles = new Set();

  const tools = [
    {
      archiveId: "whisper-cpp",
      envKeys: ["VOX_RUNTIME_PATH", "WHISPER_CLI_PATH"],
      missingMessage: "Unable to locate whisper-cli.exe for the Windows speech runtime override. Set VOX_RUNTIME_PATH to a whisper-cli.exe path or unset it to use the checked-in runtime manifest.",
      shellExecutable: "whisper-cli.exe",
      targetName: "whisper-cli.exe"
    },
    {
      archiveId: "sox",
      envKeys: ["VOX_SOX_PATH", "SOX_PATH"],
      missingMessage: "Unable to locate sox.exe for the Windows runtime override. Set VOX_SOX_PATH to a sox.exe path or unset it to use the checked-in runtime manifest.",
      shellExecutable: "sox.exe",
      targetName: "sox.exe"
    }
  ];

  for (const tool of tools) {
    const configuredPath = await resolveConfiguredExecutablePath(tool.envKeys, []);
    if (configuredPath) {
      await bundleWindowsExecutableOverride(tool.targetName, configuredPath, manifest, stagedSupportFiles);
      continue;
    }

    if (useSystemWindowsRuntime) {
      const systemPath = await resolveExecutablePath([], [], tool.shellExecutable);
      if (!systemPath) {
        throw new Error(tool.missingMessage);
      }

      await bundleWindowsExecutableOverride(tool.targetName, systemPath, manifest, stagedSupportFiles);
      continue;
    }

    const archive = archivesById.get(tool.archiveId);
    if (!archive) {
      throw new Error(`Missing Windows runtime archive definition for ${tool.archiveId}`);
    }

    if (stagedArchives.has(archive.id)) {
      continue;
    }

    const extractedPath = await ensureArchiveExtracted(archive, manifest, recordedDownloads);
    await stageArchiveFiles(archive, extractedPath, manifest);
    stagedArchives.add(archive.id);
  }
}

async function bundleWindowsExecutableOverride(targetName, sourcePath, manifest, stagedSupportFiles) {
  const bundledRuntimePath = path.join(runtimeDir, targetName);
  await fs.copyFile(sourcePath, bundledRuntimePath);
  await fs.chmod(bundledRuntimePath, 0o755);

  manifest.binaries.push({
    name: targetName,
    sourcePath,
    sha256: await sha256File(bundledRuntimePath)
  });

  process.stdout.write(`Bundled runtime binary ${targetName} from ${sourcePath}\n`);

  const sourceDir = path.dirname(sourcePath);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".dll" || stagedSupportFiles.has(entry.name)) {
      continue;
    }

    const companionSourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(runtimeDir, entry.name);
    await fs.copyFile(companionSourcePath, destinationPath);
    await fs.chmod(destinationPath, 0o755).catch(() => undefined);
    stagedSupportFiles.add(entry.name);

    manifest.supportFiles.push({
      name: entry.name,
      sourcePath: companionSourcePath,
      sha256: await sha256File(destinationPath)
    });

    process.stdout.write(`Bundled runtime support file ${entry.name} from ${companionSourcePath}\n`);
  }
}

async function ensureArchiveExtracted(archive, manifest, recordedDownloads) {
  const archivePath = await ensureArchiveDownloaded(archive, manifest, recordedDownloads);
  const extractedPath = path.join(stagingDir, archive.id);

  await fs.rm(extractedPath, { recursive: true, force: true });
  await fs.mkdir(extractedPath, { recursive: true });
  await extractArchive(archivePath, extractedPath);

  return extractedPath;
}

async function ensureArchiveDownloaded(archive, manifest, recordedDownloads) {
  const archivePath = path.join(downloadsDir, archive.archiveFileName);
  const tempArchivePath = `${archivePath}.download`;

  if (await fileExists(archivePath)) {
    const existingSha = await sha256File(archivePath);
    if (existingSha === archive.sha256) {
      recordDownload(manifest, recordedDownloads, archive, archivePath);
      return archivePath;
    }

    await fs.rm(archivePath, { force: true });
  }

  await fs.rm(tempArchivePath, { force: true });
  await downloadToFile(archive.downloadUrl, tempArchivePath, MAX_REDIRECTS, `runtime archive ${archive.archiveFileName}`);

  const downloadedSha = await sha256File(tempArchivePath);
  if (downloadedSha !== archive.sha256) {
    await fs.rm(tempArchivePath, { force: true });
    throw new Error(`Checksum mismatch for ${archive.archiveFileName}: expected ${archive.sha256} but received ${downloadedSha}`);
  }

  await fs.rename(tempArchivePath, archivePath);
  recordDownload(manifest, recordedDownloads, archive, archivePath);
  process.stdout.write(`Downloaded Windows runtime archive ${archive.archiveFileName}\n`);

  return archivePath;
}

function recordDownload(manifest, recordedDownloads, archive, archivePath) {
  if (recordedDownloads.has(archive.id)) {
    return;
  }

  recordedDownloads.add(archive.id);
  manifest.downloads.push({
    fileName: archive.archiveFileName,
    id: archive.id,
    path: archivePath,
    sha256: archive.sha256,
    url: archive.downloadUrl
  });
}

async function stageArchiveFiles(archive, extractedPath, manifest) {
  for (const file of archive.files) {
    const sourcePath = path.join(extractedPath, ...file.archivePath.split("/"));
    const destinationPath = path.join(runtimeDir, file.targetName);

    if (!(await fileExists(sourcePath))) {
      throw new Error(`Expected ${file.archivePath} in ${archive.archiveFileName}, but it was not found.`);
    }

    await fs.copyFile(sourcePath, destinationPath);
    await fs.chmod(destinationPath, 0o755).catch(() => undefined);

    const section = file.kind === "binary" ? manifest.binaries : manifest.supportFiles;
    section.push({
      name: file.targetName,
      sourcePath,
      sha256: await sha256File(destinationPath)
    });

    process.stdout.write(`Bundled runtime ${file.kind === "binary" ? "binary" : "support file"} ${file.targetName} from ${sourcePath}\n`);
  }
}

async function extractArchive(archivePath, destinationPath) {
  if (process.platform === "win32") {
    const command = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${escapePowerShellString(archivePath)}' -DestinationPath '${escapePowerShellString(destinationPath)}' -Force`
    ];
    const result = await runCommand("powershell.exe", command);
    if (result.code !== 0) {
      throw new Error(`Failed to extract ${path.basename(archivePath)}: ${result.stderr || result.stdout}`);
    }
    return;
  }

  const result = await runCommand("unzip", ["-o", "-q", archivePath, "-d", destinationPath]);
  if (result.code !== 0) {
    throw new Error(`Failed to extract ${path.basename(archivePath)}: ${result.stderr || result.stdout}`);
  }
}

function resolveBundledModels(config) {
  const bundledModelIds = Array.isArray(config?.bundledModelIds) ? config.bundledModelIds : [];
  const models = Array.isArray(config?.models) ? config.models : [];

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

async function resolveConfiguredExecutablePath(envKeys, fixedCandidates) {
  const envCandidates = envKeys.map((key) => process.env[key]).filter(Boolean);

  for (const candidate of [...envCandidates, ...fixedCandidates]) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function resolveExecutablePath(envKeys, fixedCandidates, shellExecutable) {
  const configuredPath = await resolveConfiguredExecutablePath(envKeys, fixedCandidates);
  if (configuredPath) {
    return configuredPath;
  }

  const pathResolved = await resolveFromPathEnv(shellExecutable);
  if (pathResolved && (await isExecutable(pathResolved))) {
    return pathResolved;
  }

  const shellResolved = await resolveFromShell(shellExecutable);
  if (shellResolved && (await isExecutable(shellResolved))) {
    return shellResolved;
  }

  return undefined;
}

async function isExecutable(candidate) {
  try {
    await fs.access(candidate, isWindowsTarget ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromPathEnv(executable) {
  const pathEnv = process.env.PATH || "";
  const executableNames = isWindowsTarget && path.extname(executable) === ""
    ? [executable, `${executable}.exe`]
    : [executable];

  for (const directory of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function resolveFromShell(executable) {
  return new Promise((resolve) => {
    const child = isWindowsTarget
      ? spawn("where", [executable], { stdio: ["ignore", "pipe", "ignore"] })
      : spawn(process.env.SHELL || "/bin/zsh", ["-lic", `command -v ${executable}`], { stdio: ["ignore", "pipe", "ignore"] });

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

function executableFileName(baseName) {
  if (isWindowsTarget && path.extname(baseName) === "") {
    return `${baseName}.exe`;
  }

  return baseName;
}

async function sha256File(filePath) {
  const contents = await fs.readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(urlString, destination, redirectsRemaining, label) {
  await new Promise((resolve, reject) => {
    const request = https.get(urlString, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        if (redirectsRemaining <= 0) {
          reject(new Error(`Too many redirects while downloading ${label}`));
          return;
        }

        const redirectedUrl = new URL(response.headers.location, urlString).toString();
        response.resume();
        void downloadToFile(redirectedUrl, destination, redirectsRemaining - 1, label).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`Download failed for ${label} (${statusCode})`));
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

function escapePowerShellString(value) {
  return value.replace(/'/g, "''");
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
