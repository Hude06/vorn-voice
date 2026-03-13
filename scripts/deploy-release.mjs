import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const releaseDir = path.join(root, "release");
const cliOptions = parseCliArgs(process.argv.slice(2));
const updatePlatform = cliOptions.platform === "windows" ? "windows" : "mac";
const metadataFileName = cliOptions.platform === "windows" ? "latest.yml" : "latest-mac.yml";

await loadEnvFile(path.join(root, ".env"));
await loadEnvFile(path.join(root, ".env.deploy"));

const requiredEnvKeys = ["DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_BASE_PATH"];

for (const key of requiredEnvKeys) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const deployHost = process.env.DEPLOY_HOST;
const deployUser = process.env.DEPLOY_USER;
const deployBasePath = process.env.DEPLOY_BASE_PATH;
const deployPort = process.env.DEPLOY_PORT || "22";
const deploySshKey = process.env.DEPLOY_SSH_KEY;
const deployPublicBaseUrl = process.env.DEPLOY_PUBLIC_BASE_URL || `https://${deployHost}/updates/${updatePlatform}/stable`;

const sshArgs = [];
if (deploySshKey) {
  sshArgs.push("-i", deploySshKey);
}
if (deployPort) {
  sshArgs.push("-p", deployPort);
}

const remoteRoot = `${deployUser}@${deployHost}`;
const remoteBasePath = deployBasePath.replace(/\/$/, "");
const remoteStagingPath = `${remoteBasePath}/.staging`;

if (cliOptions.bump) {
  process.stdout.write(`Bumping version (${cliOptions.bump}) before build...\n`);
  await run("npm", ["version", cliOptions.bump, "--no-git-tag-version"]);
}

const packageVersion = await readPackageVersion(path.join(root, "package.json"));

await fs.rm(releaseDir, { recursive: true, force: true });

await run("npm", ["run", "build"]);
await run("npm", ["run", cliOptions.platform === "windows" ? "prepare:vox-runtime:win" : "prepare:vox-runtime:mac"]);
await run(
  "npx",
  cliOptions.platform === "windows"
    ? ["electron-builder", "--config", "electron-builder.yml", "--win", "nsis", "--x64"]
    : ["electron-builder", "--config", "electron-builder.yml", "--mac", "zip", "dmg"]
);

const metadataPath = path.join(releaseDir, metadataFileName);
const metadata = await parseUpdateMetadata(metadataPath, metadataFileName);
if (metadata.version !== packageVersion) {
  throw new Error(`Version mismatch: package.json=${packageVersion} but ${metadataFileName}=${metadata.version}`);
}

const artifactFiles = [...metadata.files];
if (metadata.path && !artifactFiles.includes(metadata.path)) {
  artifactFiles.push(metadata.path);
}

const allUploadFiles = [metadataFileName, ...artifactFiles];
for (const artifactFile of artifactFiles) {
  await fs.access(path.join(releaseDir, artifactFile));
  const blockmapFile = `${artifactFile}.blockmap`;
  if (await fileExists(path.join(releaseDir, blockmapFile))) {
    allUploadFiles.push(blockmapFile);
  }
}

const uniqueUploadFiles = [...new Set(allUploadFiles)].sort((a, b) => a.localeCompare(b));
const uploadPaths = uniqueUploadFiles.map((fileName) => path.join(releaseDir, fileName));
const nonMetadataPaths = uploadPaths.filter((filePath) => path.basename(filePath) !== metadataFileName);

process.stdout.write(`Deploying version ${packageVersion} with files:\n`);
for (const fileName of uniqueUploadFiles) {
  process.stdout.write(`- ${fileName}\n`);
}

await run("ssh", [...sshArgs, remoteRoot, `mkdir -p "${remoteBasePath}" "${remoteStagingPath}"`]);

await run("rsync", [
  "-av",
  ...buildSshTransportArgs(sshArgs),
  ...uploadPaths,
  `${remoteRoot}:${remoteStagingPath}/`
]);

await run("rsync", [
  "-av",
  ...buildSshTransportArgs(sshArgs),
  ...nonMetadataPaths,
  `${remoteRoot}:${remoteBasePath}/`
]);

await run("rsync", [
  "-av",
  ...buildSshTransportArgs(sshArgs),
  metadataPath,
  `${remoteRoot}:${remoteBasePath}/${metadataFileName}`
]);

process.stdout.write("Deploy complete. Verify with:\n");
process.stdout.write(`curl -i ${deployPublicBaseUrl}/${metadataFileName}\n`);
process.stdout.write(`Expected deployed version: ${packageVersion}\n`);

function buildSshTransportArgs(sshParameters) {
  if (sshParameters.length === 0) {
    return [];
  }

  return ["-e", `ssh ${sshParameters.map(escapeShellArg).join(" ")}`];
}

function escapeShellArg(value) {
  if (/^[a-zA-Z0-9._\/-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`Command failed (${command} ${args.join(" ")}) with exit code ${code ?? -1}`));
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageVersion(packageJsonPath) {
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.version || typeof parsed.version !== "string") {
    throw new Error("Could not determine package.json version.");
  }

  return parsed.version;
}

async function parseUpdateMetadata(filePath, metadataLabel) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let version = "";
  let mainPath = "";
  const files = [];

  for (const line of lines) {
    const versionMatch = line.match(/^version:\s*(.+)$/);
    if (versionMatch) {
      version = stripYamlValue(versionMatch[1]);
      continue;
    }

    const pathMatch = line.match(/^path:\s*(.+)$/);
    if (pathMatch) {
      mainPath = stripYamlValue(pathMatch[1]);
      continue;
    }

    const fileMatch = line.match(/^\s*-\s+url:\s*(.+)$/);
    if (fileMatch) {
      files.push(stripYamlValue(fileMatch[1]));
    }
  }

  if (!version) {
    throw new Error(`Could not parse version from ${metadataLabel}.`);
  }

  return {
    version,
    path: mainPath,
    files
  };
}

function stripYamlValue(value) {
  const trimmed = value.trim();
  return stripWrappingQuotes(trimmed);
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = stripWrappingQuotes(value);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function stripWrappingQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function parseCliArgs(args) {
  const options = {
    bump: null,
    platform: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--platform")) {
      const inlineValue = arg.includes("=") ? arg.split("=")[1] : undefined;
      const nextValue = inlineValue ?? args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --platform. Use mac or windows.");
      }

      if (!["mac", "windows"].includes(nextValue)) {
        throw new Error(`Invalid --platform value: ${nextValue}. Use mac or windows.`);
      }

      options.platform = nextValue;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (!arg.startsWith("--bump")) {
      continue;
    }

    const inlineValue = arg.includes("=") ? arg.split("=")[1] : undefined;
    const nextValue = inlineValue ?? args[index + 1];
    if (!nextValue) {
      throw new Error("Missing value for --bump. Use patch, minor, or major.");
    }

    if (!["patch", "minor", "major"].includes(nextValue)) {
      throw new Error(`Invalid --bump value: ${nextValue}. Use patch, minor, or major.`);
    }

    options.bump = nextValue;
    if (!inlineValue) {
      index += 1;
    }
  }

  if (!options.platform) {
    throw new Error("Missing required --platform argument. Use mac or windows.");
  }

  return options;
}
