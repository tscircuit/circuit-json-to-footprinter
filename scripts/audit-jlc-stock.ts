import { convertEasyEdaJsonToCircuitJson, EasyEdaJsonSchema } from "easyeda"
import { fetchEasyEDAComponent } from "easyeda/browser"
import { circuitJsonToFootprinter } from "../lib/index.js"

const JLCSEARCH_ORIGIN = "https://jlcsearch.tscircuit.com"
const COPPER_IOU_THRESHOLD = 0.95

const categoryRoutes = [
  "microcontrollers",
  "ldos",
  "usb_c_connectors",
  "switches",
  "gyroscopes",
  "mosfets",
  "adcs",
] as const

interface JlcPart {
  lcsc: number
  mfr: string
  package: string
  stock: number
}

const getTopStockPart = async (category: string): Promise<JlcPart> => {
  const response = await fetch(`${JLCSEARCH_ORIGIN}/${category}/list.json`)
  if (!response.ok) {
    throw new Error(
      `jlcsearch ${category} request failed with ${response.status}`,
    )
  }

  const payload = (await response.json()) as Record<string, unknown>
  const parts = Object.values(payload).find(Array.isArray) as
    | JlcPart[]
    | undefined
  const topPart = parts?.[0]
  if (!topPart) throw new Error(`jlcsearch returned no ${category}`)
  return topPart
}

const auditCategory = async (category: string) => {
  const part = await getTopStockPart(category)
  const lcsc = `C${part.lcsc}`
  const rawEasy = await fetchEasyEDAComponent(lcsc)
  const circuitJson = convertEasyEdaJsonToCircuitJson(
    EasyEdaJsonSchema.parse(rawEasy),
    { useModelCdn: false },
  )
  const result = circuitJsonToFootprinter(circuitJson, {
    maxCandidates: 3,
    sourceHints: [
      `${lcsc} ${part.mfr} ${part.package} ${category.replaceAll("_", " ")}`,
    ],
  })

  return {
    category,
    lcsc,
    manufacturerPartNumber: part.mfr,
    package: part.package,
    stock: part.stock,
    padCount: result.diagnostics.targetPadCount,
    footprinterString: result.best?.footprinterString ?? "NO CANDIDATE",
    copperIoU: result.best?.copperIntersectionOverUnion ?? 0,
  }
}

const results = []
for (const category of categoryRoutes) {
  results.push(await auditCategory(category))
}

console.table(
  results.map((result) => ({
    category: result.category,
    lcsc: result.lcsc,
    mfr: result.manufacturerPartNumber,
    package: result.package,
    stock: result.stock,
    pads: result.padCount,
    footprinter: result.footprinterString,
    copperIoU: result.copperIoU.toFixed(4),
  })),
)

const misses = results.filter(
  (result) => result.copperIoU < COPPER_IOU_THRESHOLD,
)
if (misses.length > 0) {
  console.error(
    `${misses.length}/${results.length} category leaders are below ${COPPER_IOU_THRESHOLD.toFixed(2)} copper IoU`,
  )
  process.exitCode = 1
}
