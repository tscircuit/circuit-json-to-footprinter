import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Circuit } from "tscircuit"
import { summarizeCopperComparison } from "../lib/compare-copper.js"
import {
  circuitJsonToFootprint,
  footprinterStringToFootprint,
} from "../lib/footprint.js"
import { circuitJsonToFootprinter } from "../lib/index.js"
import {
  createBenchmarkReport,
  type FootprinterBenchmarkResult,
  formatBenchmarkMarkdown,
} from "./benchmark-report.js"

interface Jlc5000Part {
  candidate: {
    description?: string
    lcsc: number
    mfr: string
    package: string
  }
  componentName: string
  features: {
    padCount: number
  }
}

interface Jlc5000Manifest {
  accepted: Jlc5000Part[]
}

const valueAfter = (flag: string) => {
  const index = Bun.argv.indexOf(flag)
  return index >= 0 ? Bun.argv[index + 1] : undefined
}

const threshold = Number(valueAfter("--threshold") ?? "0.95")
const limit = Number(valueAfter("--limit") ?? "0")
const minimumPercent = Number(valueAfter("--minimum-percent") ?? "0")
const jsonPath = valueAfter("--json")
const markdownPath = valueAfter("--markdown")
const jlc5000Root = resolve(
  valueAfter("--jlc5000-root") ?? `${import.meta.dir}/../../jlc5000`,
)

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  throw new Error("--threshold must be between 0 and 1")
}
if (!Number.isFinite(limit) || limit < 0) {
  throw new Error("--limit must be zero or a positive number")
}
if (
  !Number.isFinite(minimumPercent) ||
  minimumPercent < 0 ||
  minimumPercent > 100
) {
  throw new Error("--minimum-percent must be between 0 and 100")
}

const manifestPath = resolve(jlc5000Root, "data/manifest.json")
const manifestFile = Bun.file(manifestPath)
if (!(await manifestFile.exists())) {
  throw new Error(
    `JLC5000 manifest not found at ${manifestPath}. Pass --jlc5000-root <path>.`,
  )
}

const manifest = (await manifestFile.json()) as Jlc5000Manifest
const accepted =
  limit > 0 ? manifest.accepted.slice(0, limit) : manifest.accepted
if (accepted.length === 0)
  throw new Error("No accepted components to benchmark")

const packageJson = await Bun.file("package.json").json()
const packageVersion = String(packageJson.version ?? "unknown")
const results: FootprinterBenchmarkResult[] = []

for (const [index, part] of accepted.entries()) {
  const label = `C${part.candidate.lcsc} ${part.candidate.mfr}`
  process.stderr.write(`[${index + 1}/${accepted.length}] ${label}\n`)
  const startedAt = performance.now()

  try {
    const boardPath = resolve(
      jlc5000Root,
      "boards",
      `${part.componentName}.circuit.tsx`,
    )
    const boardModule = await import(pathToFileURL(boardPath).href)
    if (typeof boardModule.default !== "function") {
      throw new Error(`Inspection board has no default component: ${boardPath}`)
    }

    const circuit = new Circuit()
    circuit.add(boardModule.default())
    const circuitJson = circuit.getCircuitJson()
    const sourceHints = [
      part.candidate.package,
      part.candidate.mfr,
      part.candidate.description,
    ].filter((value): value is string => Boolean(value))
    const target = circuitJsonToFootprint(circuitJson, {
      sourceHints,
      title: part.candidate.mfr,
      subtitle: `JLCPCB C${part.candidate.lcsc}`,
    })
    const discovery = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 1,
      sourceHints,
      title: target.title,
      subtitle: target.subtitle,
    })
    const footprinterString = discovery.best?.footprinterString
    const copperIntersectionOverUnion = footprinterString
      ? summarizeCopperComparison(
          footprinterStringToFootprint(footprinterString),
          target,
        ).copperIntersectionOverUnion
      : 0

    results.push({
      lcsc: part.candidate.lcsc,
      manufacturerPartNumber: part.candidate.mfr,
      packageName: part.candidate.package,
      padCount: target.pads.length,
      copperIntersectionOverUnion,
      footprinterString: footprinterString ?? null,
      family: discovery.best?.family ?? null,
      durationMs: performance.now() - startedAt,
    })
  } catch (error) {
    results.push({
      lcsc: part.candidate.lcsc,
      manufacturerPartNumber: part.candidate.mfr,
      packageName: part.candidate.package,
      padCount: part.features.padCount,
      copperIntersectionOverUnion: 0,
      footprinterString: null,
      family: null,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const report = createBenchmarkReport({ results, threshold, packageVersion })
const markdown = formatBenchmarkMarkdown(report)

const writeOutput = async (path: string, contents: string) => {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await Bun.write(path, contents)
}

if (jsonPath) {
  await writeOutput(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
}
if (markdownPath) {
  await writeOutput(markdownPath, markdown)
}

console.log(markdown)

if (report.matchPercent < minimumPercent) {
  console.error(
    `Benchmark ${report.matchPercent.toFixed(2)}% is below --minimum-percent ${minimumPercent.toFixed(2)}%`,
  )
  process.exit(1)
}
