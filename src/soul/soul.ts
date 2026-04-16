import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_DIR } from "../shared/paths.js";

const SOUL_PATH = join(DATA_DIR, "SOUL.md");

const DEFAULT_SOUL = `# Soul
You are a helpful AI assistant on Discord.
Be concise, friendly, and direct.
Use casual tone appropriate for Discord.
`;

let soulContent = "";
let watcher: FSWatcher | null = null;

async function loadSoul(): Promise<void> {
  try {
    soulContent = await readFile(SOUL_PATH, "utf-8");
    console.log("[soul] Loaded SOUL.md");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[soul] SOUL.md not found, creating default");
      await mkdir(dirname(SOUL_PATH), { recursive: true });
      await writeFile(SOUL_PATH, DEFAULT_SOUL, "utf-8");
      soulContent = DEFAULT_SOUL;
      console.log("[soul] Created default SOUL.md");
    } else {
      throw err;
    }
  }
}

function startWatcher(): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watcher = watch(SOUL_PATH, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        soulContent = await readFile(SOUL_PATH, "utf-8");
        console.log("[soul] Reloaded SOUL.md");
      } catch {
        // File may have been briefly removed during an editor save; ignore.
      }
    }, 500);
  });
}

export async function initSoul(): Promise<void> {
  await loadSoul();
  startWatcher();
}

export function getSoul(): string {
  return soulContent;
}

export async function setSoul(content: string): Promise<void> {
  await writeFile(SOUL_PATH, content, "utf-8");
  // The file watcher will pick up the change and reload soulContent.
}

export function stopSoulWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log("[soul] Watcher stopped");
  }
}
