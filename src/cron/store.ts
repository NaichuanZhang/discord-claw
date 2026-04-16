import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { DATA_DIR } from "../shared/paths.js";
import type {
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronRunEntry,
  CronStoreData,
} from "./types.js";

const JOBS_PATH = path.join(DATA_DIR, "cron", "jobs.json");
const JOBS_TMP_PATH = JOBS_PATH + ".tmp";
const RUNS_DIR = path.join(DATA_DIR, "cron", "runs");

function log(...args: unknown[]): void {
  console.log("[cron-store]", ...args);
}

/** Ensure a loaded job has all required runtime fields. */
function normalizeJob(raw: Partial<CronJob> & { id: string }): CronJob {
  return {
    ...raw,
    enabled: raw.enabled ?? true,
    state: raw.state ?? {},
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
  } as CronJob;
}

export class CronStore {
  private jobs: CronJob[] = [];
  /** mtime of jobs.json when we last read it (ms). */
  private lastMtimeMs = 0;

  /** Load jobs from disk (or create empty store). */
  load(): CronJob[] {
    try {
      const raw = fs.readFileSync(JOBS_PATH, "utf-8");
      const data: CronStoreData = JSON.parse(raw);
      this.jobs = (data.jobs ?? []).map(normalizeJob);
      this.lastMtimeMs = this.getFileMtime();
      log(`Loaded ${this.jobs.length} job(s) from disk`);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        log("No jobs file found, starting with empty store");
        this.jobs = [];
      } else {
        log("Error loading jobs file, starting with empty store:", err);
        this.jobs = [];
      }
    }
    return this.jobs;
  }

  /**
   * Hot-reload: re-read jobs.json only if the file was modified externally
   * since our last read/write. Returns true if new jobs were discovered.
   *
   * This is cheap — just a stat() call most of the time.
   */
  reload(): boolean {
    const currentMtime = this.getFileMtime();
    if (currentMtime === 0 || currentMtime <= this.lastMtimeMs) {
      return false; // file unchanged (or missing)
    }

    log("jobs.json changed on disk, hot-reloading…");

    let diskJobs: CronJob[];
    try {
      const raw = fs.readFileSync(JOBS_PATH, "utf-8");
      const data: CronStoreData = JSON.parse(raw);
      diskJobs = (data.jobs ?? []).map(normalizeJob);
    } catch (err) {
      log("Error reading jobs.json during hot-reload:", err);
      return false;
    }

    this.lastMtimeMs = currentMtime;

    // Build a map of existing in-memory jobs by ID so we can preserve runtime state
    const existingById = new Map(this.jobs.map((j) => [j.id, j]));
    let newJobCount = 0;

    const merged: CronJob[] = diskJobs.map((diskJob) => {
      const existing = existingById.get(diskJob.id);
      if (existing) {
        // Job already known — keep our runtime state, but accept
        // updated config fields (name, schedule, payload, delivery, etc.)
        return {
          ...diskJob,
          state: existing.state, // preserve runtime state
        };
      }
      // Brand new job from disk
      newJobCount++;
      return diskJob;
    });

    this.jobs = merged;

    if (newJobCount > 0) {
      log(`Hot-reload: discovered ${newJobCount} new job(s)`);
    }
    return newJobCount > 0;
  }

  /** Save current jobs to disk (atomic: write temp file, then rename). */
  save(): void {
    const data: CronStoreData = { version: 1, jobs: this.jobs };
    const dir = path.dirname(JOBS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JOBS_TMP_PATH, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(JOBS_TMP_PATH, JOBS_PATH);
    // Update our mtime so we don't re-read our own write
    this.lastMtimeMs = this.getFileMtime();
  }

  /** Get all jobs (in-memory). */
  getJobs(): CronJob[] {
    return this.jobs;
  }

  /** Get single job by ID. */
  getJob(id: string): CronJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  /** Add a new job from CronJobCreate. */
  addJob(input: CronJobCreate): CronJob {
    const now = Date.now();
    const job: CronJob = {
      ...input,
      id: input.id ?? nanoid(),
      state: {},
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.push(job);
    this.save();
    log(`Added job "${job.name}" (${job.id})`);
    return job;
  }

  /** Update existing job with patch. */
  updateJob(id: string, patch: CronJobPatch): CronJob | undefined {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return undefined;

    Object.assign(job, patch);
    job.updatedAt = Date.now();
    this.save();
    log(`Updated job "${job.name}" (${job.id})`);
    return job;
  }

  /** Update job state (nextRunAtMs, lastRunAtMs, etc.). */
  updateJobState(id: string, state: Partial<CronJob["state"]>): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;

    if (!job.state) job.state = {};
    Object.assign(job.state, state);
    this.save();
  }

  /** Remove a job by ID. */
  removeJob(id: string): boolean {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    if (this.jobs.length < before) {
      this.save();
      log(`Removed job ${id}`);
      return true;
    }
    return false;
  }

  /** Append a run entry to the job's JSONL run history. */
  appendRunEntry(entry: CronRunEntry): void {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const filePath = path.join(RUNS_DIR, `${entry.jobId}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  /** Get run history for a job (read JSONL, most recent first). */
  getRunHistory(jobId: string, limit?: number): CronRunEntry[] {
    const filePath = path.join(RUNS_DIR, `${jobId}.jsonl`);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return [];
      }
      throw err;
    }

    const entries: CronRunEntry[] = raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as CronRunEntry)
      .reverse();

    if (limit !== undefined && limit >= 0) {
      return entries.slice(0, limit);
    }
    return entries;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Get mtime of the jobs file in ms, or 0 if the file doesn't exist. */
  private getFileMtime(): number {
    try {
      return fs.statSync(JOBS_PATH).mtimeMs;
    } catch {
      return 0;
    }
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
