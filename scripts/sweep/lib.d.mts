export const EXTENSIONS: string[];
export const SKIP_DIRS: string[];
export const SCHEMA: number;
export const CLASSES: string[];
export const CLASS_LABELS: Record<string, string>;
export const METRIC_KEYS: string[];
export const USAGE: string;

export interface SweepOptions {
  dirs: string[];
  out: string | null;
  jobs: number;
  limit: number | null;
  minMb: number;
  timeoutSec: number;
  mem: boolean;
  help: boolean;
  errors: string[];
}
export function parseArgs(argv: string[], env?: Record<string, string | undefined>, cpus?: number): SweepOptions;
export function editionOf(major: number | null | undefined): string;
export function editionOrder(a: string, b: string): number;
export function classify(rec: {
  error?: string;
  header?: unknown;
  flags?: string[];
  warnings?: string[];
  metrics?: { meshes?: number; lines?: number };
}): string;
export function warningCode(msg: string): string;
export function exceptionCode(err: string): string;

export interface Percentiles {
  n: number;
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  max?: number;
  mean?: number;
}
export function percentiles(values: number[]): Percentiles;
export function summarize(records: any[], info?: Record<string, unknown>): any;
export function formatSummary(summary: any): string;

export interface CompareResult {
  common: number;
  onlyBefore: number;
  onlyAfter: number;
  classChanged: number;
  classChanges: { sha256: string; edition: string; before: string; after: string }[];
  metricChanged: number;
  metricChanges: { sha256: string; edition: string; changes: Record<string, [unknown, unknown]> }[];
  newExceptions: { sha256: string; edition: string; code: string }[];
  fixedExceptions: { sha256: string; edition: string; code: string }[];
  timingMs: { before: Percentiles; after: Percentiles };
  changed: boolean;
}
export function compareRuns(before: any[], after: any[], opts?: { top?: number }): CompareResult;
export function formatCompare(result: CompareResult): string;
