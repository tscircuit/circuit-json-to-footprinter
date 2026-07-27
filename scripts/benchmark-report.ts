export interface FootprinterBenchmarkResult {
  lcsc: number
  manufacturerPartNumber: string
  packageName: string
  padCount: number
  copperIntersectionOverUnion: number
  footprinterString: string | null
  family: string | null
  durationMs: number
  error?: string
}

export interface FootprinterBenchmarkReport {
  schemaVersion: 1
  generatedAt: string
  packageVersion: string
  threshold: number
  total: number
  matched: number
  belowThreshold: number
  errors: number
  matchRate: number
  matchPercent: number
  results: FootprinterBenchmarkResult[]
}

export const createBenchmarkReport = ({
  results,
  threshold,
  packageVersion,
}: {
  results: FootprinterBenchmarkResult[]
  threshold: number
  packageVersion: string
}): FootprinterBenchmarkReport => {
  const matched = results.filter(
    (result) =>
      !result.error && result.copperIntersectionOverUnion >= threshold,
  ).length
  const errors = results.filter((result) => result.error).length
  const total = results.length
  const matchRate = total === 0 ? 0 : matched / total

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    packageVersion,
    threshold,
    total,
    matched,
    belowThreshold: total - matched - errors,
    errors,
    matchRate,
    matchPercent: matchRate * 100,
    results,
  }
}

const escapeCell = (value: string) =>
  value.split("|").join("\\|").split("\n").join(" ")

const percent = (value: number) => `${(value * 100).toFixed(2)}%`

export const formatBenchmarkMarkdown = (
  report: FootprinterBenchmarkReport,
  failureLimit = 25,
) => {
  const misses = report.results
    .filter(
      (result) =>
        result.error || result.copperIntersectionOverUnion < report.threshold,
    )
    .sort(
      (left, right) =>
        left.copperIntersectionOverUnion - right.copperIntersectionOverUnion,
    )
    .slice(0, failureLimit)

  const lines = [
    "## Footprinter benchmark",
    "",
    `**${report.matched}/${report.total} components (${report.matchPercent.toFixed(2)}%) have at least ${percent(report.threshold)} copper IoU.**`,
    "",
    `- Package: \`circuit-json-to-footprinter@${report.packageVersion}\``,
    `- Below threshold: ${report.belowThreshold}`,
    `- Errors: ${report.errors}`,
  ]

  if (misses.length > 0) {
    lines.push(
      "",
      `### Lowest matches (up to ${failureLimit})`,
      "",
      "| LCSC | Part | Package | IoU | Best footprinter |",
      "| --- | --- | --- | ---: | --- |",
      ...misses.map((result) => {
        const best = result.error
          ? `Error: ${result.error}`
          : (result.footprinterString ?? "No candidate")
        return `| C${result.lcsc} | ${escapeCell(result.manufacturerPartNumber)} | ${escapeCell(result.packageName)} | ${percent(result.copperIntersectionOverUnion)} | ${escapeCell(best)} |`
      }),
    )
  }

  lines.push(
    "",
    "The percentage is measured against each component's exact imported JLC/EasyEDA copper geometry on Fast Footprint Compare's 320x320 raster.",
    "",
  )
  return lines.join("\n")
}
