import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronRunEntry,
  CronStoreData,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const JOBS_PATH = path.join(PROJECT_ROOT, "data", "cron", "jobs.json");
const JOBS_TMP_PATH = JOBS_PATH + ".tmp";
const RUNS_DIR = path.join(PROJECT_ROOT, "data", "cron", "runs");

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

  /** Load jobs from disk (or create empty store). */
  load(): CronJob[] {
    try {
      const raw = fs.readFileSync(JOBS_PATH, "utf-8");
      const data: CronStoreData = JSON.parse(raw);
      this.jobs = (data.jobs ?? []).map(normalizeJob);
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

  /** Save current jobs to disk (atomic: write temp file, then rename). */
  save(): void {
    const data: CronStoreData = { version: 1, jobs: this.jobs };
    const dir = path.dirname(JOBS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JOBS_TMP_PATH, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(JOBS_TMP_PATH, JOBS_PATH);
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
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
