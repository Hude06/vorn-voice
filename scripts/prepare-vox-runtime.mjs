import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const runtimeDir = path.join(root, "build", "runtime", "bin");
const manifestPath = path.join(root, "build", "runtime", "runtime-manifest.json");

await fs.mkdir(runtimeDir, { recursive: true });

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

const manifest = { binaries: [] };

for (const binary of binaries) {
  const sourcePath = await resolveExecutablePath(binary.envKeys, binary.fixedCandidates, binary.shellExecutable);
  if (!sourcePath) {
    throw new Error(binary.missingMessage);
  }

  const bundledRuntimePath = path.join(runtimeDir, binary.targetName);
  await fs.copyFile(sourcePath, bundledRuntimePath);
  await fs.chmod(bundledRuntimePath, 0o755);

  manifest.binaries.push({
    name: binary.targetName,
    sourcePath,
    sha256: await sha256File(sourcePath)
  });

  process.stdout.write(`Bundled runtime binary ${binary.targetName} from ${sourcePath}\n`);
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
