import { getFootprintNames, getFootprintSizes } from "@tscircuit/footprinter"
import {
  type FootprintPreview,
  footprinterStringToPreview,
  type PreviewPad,
} from "./circuit-json-preview.js"
import { summarizeCopperComparison } from "./compare-copper.js"

const SEARCH_GRID_SIZE = 112
const MAX_OPTIMIZED_SEEDS = 10
const OPTIMIZATION_STEPS = 16
const NUMERIC_PARAMETERS = [
  "p",
  "w",
  "h",
  "pw",
  "ph",
  "pl",
  "pad",
  "ball",
  "od",
  "id",
] as const

type NumericParameter = (typeof NUMERIC_PARAMETERS)[number]
type Topology = "four-sided" | "grid" | "irregular" | "linear" | "two-sided"

interface Bounds {
  height: number
  maxX: number
  maxY: number
  minX: number
  minY: number
  width: number
}

interface TargetAnalysis {
  bounds: Bounds
  gridColumns: number
  gridRows: number
  heuristics: Record<NumericParameter, number>
  perimeterPadCount: number
  platedHoleCount: number
  thermalPad?: {
    height: number
    width: number
  }
  topology: Topology
}

interface SeedCandidate {
  family: string
  footprinterString: string
  geometryScore: number
  preview: FootprintPreview
}

export interface FootprinterDiscoveryCandidate {
  copperIntersectionOverUnion: number
  domainScore: number
  family: string
  footprinterString: string
  geometryScore: number
  optimizedParameters: Partial<Record<NumericParameter, number>>
  rankingScore: number
}

export interface FootprinterDiscoveryResult {
  best: FootprinterDiscoveryCandidate | null
  candidates: FootprinterDiscoveryCandidate[]
  diagnostics: {
    evaluatedSeeds: number
    optimizedSeeds: number
    targetPadCount: number
    topology: Topology
  }
  target: FootprintPreview
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const getPadBounds = (pad: PreviewPad): Bounds => {
  const radians = (pad.rotation * Math.PI) / 180
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))
  const width = pad.width * cosine + pad.height * sine
  const height = pad.width * sine + pad.height * cosine

  return {
    height,
    maxX: pad.x + width / 2,
    maxY: pad.y + height / 2,
    minX: pad.x - width / 2,
    minY: pad.y - height / 2,
    width,
  }
}

const getBounds = (pads: PreviewPad[]): Bounds => {
  const padBounds = pads.map(getPadBounds)
  const minX = Math.min(...padBounds.map((bound) => bound.minX))
  const minY = Math.min(...padBounds.map((bound) => bound.minY))
  const maxX = Math.max(...padBounds.map((bound) => bound.maxX))
  const maxY = Math.max(...padBounds.map((bound) => bound.maxY))

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}

const clusterCoordinates = (values: number[], tolerance: number) => {
  const sorted = [...values].sort((left, right) => left - right)
  const clusters: number[][] = []

  for (const value of sorted) {
    const cluster = clusters.at(-1)
    if (!cluster || Math.abs(value - median(cluster)) > tolerance) {
      clusters.push([value])
    } else {
      cluster.push(value)
    }
  }

  return clusters.map(median)
}

const getPitchEstimate = (pads: PreviewPad[], tolerance: number) => {
  const medianPadArea = median(pads.map((pad) => pad.width * pad.height))
  const regularPads = pads.filter(
    (pad) => pad.width * pad.height <= medianPadArea * 2.5,
  )
  const differences: number[] = []

  for (const [fixedAxis, movingAxis] of [
    ["x", "y"],
    ["y", "x"],
  ] as const) {
    const fixedCoordinates = clusterCoordinates(
      regularPads.map((pad) => pad[fixedAxis]),
      tolerance,
    )
    for (const fixedCoordinate of fixedCoordinates) {
      const movingCoordinates = clusterCoordinates(
        regularPads
          .filter(
            (pad) => Math.abs(pad[fixedAxis] - fixedCoordinate) <= tolerance,
          )
          .map((pad) => pad[movingAxis]),
        tolerance,
      )
      differences.push(
        ...movingCoordinates
          .slice(1)
          .map((coordinate, index) => coordinate - movingCoordinates[index])
          .filter((difference) => difference > tolerance),
      )
    }
  }

  if (!differences.length) return Math.max(tolerance * 2, 1)
  // Two-sided packages contribute both the lead pitch and the much larger
  // distance between rows. Prefer the lower quartile so the row span does not
  // pull the pitch estimate away from the repeated lead spacing.
  const sortedDifferences = differences.toSorted((left, right) => left - right)
  return sortedDifferences[Math.floor((sortedDifferences.length - 1) * 0.25)]
}

const analyzeTarget = (target: FootprintPreview): TargetAnalysis => {
  const bounds = getBounds(target.pads)
  const padBounds = target.pads.map(getPadBounds)
  const medianPadWidth = median(padBounds.map((bound) => bound.width))
  const medianPadHeight = median(padBounds.map((bound) => bound.height))
  const tolerance = Math.max(
    Math.min(medianPadWidth, medianPadHeight) * 0.22,
    0.015,
  )
  const xCoordinates = clusterCoordinates(
    target.pads.map((pad) => pad.x),
    tolerance,
  )
  const yCoordinates = clusterCoordinates(
    target.pads.map((pad) => pad.y),
    tolerance,
  )
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const edgeToleranceX = Math.max(medianPadWidth * 0.75, bounds.width * 0.08)
  const edgeToleranceY = Math.max(medianPadHeight * 0.75, bounds.height * 0.08)
  const sidePads = target.pads.filter(
    (pad) =>
      Math.abs(pad.x - (bounds.minX + medianPadWidth / 2)) <= edgeToleranceX ||
      Math.abs(pad.x - (bounds.maxX - medianPadWidth / 2)) <= edgeToleranceX ||
      Math.abs(pad.y - (bounds.minY + medianPadHeight / 2)) <= edgeToleranceY ||
      Math.abs(pad.y - (bounds.maxY - medianPadHeight / 2)) <= edgeToleranceY,
  )
  const medianPadArea = median(
    padBounds.map((bound) => bound.width * bound.height),
  )
  const thermalPad = target.pads
    .map((pad) => ({ bound: getPadBounds(pad), pad }))
    .filter(
      ({ bound, pad }) =>
        Math.abs(pad.x - centerX) <= medianPadWidth &&
        Math.abs(pad.y - centerY) <= medianPadHeight &&
        bound.width * bound.height > medianPadArea * 2.5,
    )
    .sort(
      (left, right) =>
        right.bound.width * right.bound.height -
        left.bound.width * left.bound.height,
    )[0]?.bound
  const gridOccupancy =
    target.pads.length / Math.max(xCoordinates.length * yCoordinates.length, 1)
  const hasPadsOnFourSides =
    sidePads.filter((pad) => Math.abs(pad.x - centerX) > bounds.width * 0.3)
      .length >= 4 &&
    sidePads.filter((pad) => Math.abs(pad.y - centerY) > bounds.height * 0.3)
      .length >= 4

  let topology: Topology = "irregular"
  if (xCoordinates.length === 1 || yCoordinates.length === 1) {
    topology = "linear"
  } else if (xCoordinates.length <= 2 || yCoordinates.length <= 2) {
    topology = "two-sided"
  } else if (
    target.pads.length >= 4 &&
    xCoordinates.length >= 2 &&
    yCoordinates.length >= 2 &&
    gridOccupancy >= 0.68
  ) {
    topology = "grid"
  } else if (hasPadsOnFourSides && target.pads.length >= 8) {
    topology = "four-sided"
  }

  const pitch = getPitchEstimate(target.pads, tolerance)
  const medianPadLongSide = median(
    padBounds.map((bound) => Math.max(bound.width, bound.height)),
  )
  const medianPadShortSide = median(
    padBounds.map((bound) => Math.min(bound.width, bound.height)),
  )
  const medianPadDiameter = median(
    padBounds.map((bound) => Math.sqrt(bound.width * bound.height)),
  )
  const platedHoleCount = target.pads.filter(
    (pad) => pad.kind === "plated-hole",
  ).length
  const insetQuadAdjustment = topology === "four-sided" ? 0.2 : 0

  return {
    bounds,
    gridColumns: xCoordinates.length,
    gridRows: yCoordinates.length,
    heuristics: {
      ball: medianPadDiameter,
      h: bounds.height + insetQuadAdjustment,
      id: medianPadDiameter * 0.6,
      od: medianPadDiameter,
      p: pitch,
      pad: medianPadDiameter,
      ph: medianPadHeight,
      pl: medianPadLongSide,
      pw: medianPadShortSide,
      w: bounds.width + insetQuadAdjustment,
    },
    perimeterPadCount: sidePads.length,
    platedHoleCount,
    thermalPad: thermalPad
      ? { height: thermalPad.height, width: thermalPad.width }
      : undefined,
    topology,
  }
}

const normalizePads = (pads: PreviewPad[]) => {
  const bounds = getBounds(pads)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return pads.map((pad) => ({
    ...pad,
    x: pad.x - centerX,
    y: pad.y - centerY,
  }))
}

const getOrientedPadSize = (pad: PreviewPad) => {
  const bounds = getPadBounds({ ...pad, x: 0, y: 0 })
  return { height: bounds.height, width: bounds.width }
}

const matchPadsByPosition = (left: PreviewPad[], right: PreviewPad[]) => {
  const availableRight = new Set(right.map((_, index) => index))
  return left.map((leftPad) => {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const rightIndex of availableRight) {
      const rightPad = right[rightIndex]
      const distance = Math.hypot(
        leftPad.x - rightPad.x,
        leftPad.y - rightPad.y,
      )
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = rightIndex
      }
    }
    availableRight.delete(bestIndex)
    return [leftPad, right[bestIndex]] as const
  })
}

const getGeometryLoss = (
  candidate: FootprintPreview,
  target: FootprintPreview,
) => {
  if (candidate.pads.length !== target.pads.length) return 1_000

  const candidatePads = normalizePads(candidate.pads)
  const targetPads = normalizePads(target.pads)
  const targetBounds = getBounds(targetPads)
  const positionScale = Math.max(
    Math.hypot(targetBounds.width, targetBounds.height),
    0.1,
  )
  const pairs = matchPadsByPosition(candidatePads, targetPads)
  let loss = 0

  for (const [candidatePad, targetPad] of pairs) {
    const candidateSize = getOrientedPadSize(candidatePad)
    const targetSize = getOrientedPadSize(targetPad)
    const dx = (candidatePad.x - targetPad.x) / positionScale
    const dy = (candidatePad.y - targetPad.y) / positionScale
    const dw =
      (candidateSize.width - targetSize.width) /
      Math.max(targetSize.width, 0.05)
    const dh =
      (candidateSize.height - targetSize.height) /
      Math.max(targetSize.height, 0.05)

    loss += dx * dx * 4 + dy * dy * 4 + dw * dw + dh * dh
    if (candidatePad.kind !== targetPad.kind) loss += 4
    if (candidatePad.shape !== targetPad.shape) loss += 0.08
  }

  return loss / pairs.length
}

const getGeometryScore = (
  candidate: FootprintPreview,
  target: FootprintPreview,
) => 1 / (1 + getGeometryLoss(candidate, target))

const getDomainScore = (target: FootprintPreview, family: string) => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  const aliases: Record<string, string[]> = {
    cap: ["capacitor", "cap"],
    dfn: ["dfn"],
    qfn: ["qfn"],
    res: ["resistor", "res"],
    soic: ["soic", "so-"],
    ssop: ["ssop"],
    tssop: ["tssop"],
    usbcmidmount: ["usb-c", "usb c", "type-c", "type c", "usbc"],
  }
  const terms = aliases[family] ?? [family]
  return terms.some((term) => description.includes(term)) ? 1 : 0
}

const getFamily = (footprinterString: string) => {
  if (/^\d{4,5}(?:_|$)/.test(footprinterString)) return "res"
  return (
    [...getFootprintNames()]
      .sort((left, right) => right.length - left.length)
      .find(
        (family) =>
          footprinterString === family ||
          new RegExp(`^${family}(?:\\d|_)`).test(footprinterString),
      ) ??
    footprinterString.match(/^[a-z]+/i)?.[0] ??
    footprinterString
  )
}

const tryBuild = (footprinterString: string) => {
  try {
    return footprinterStringToPreview(footprinterString)
  } catch {
    return null
  }
}

const formatMillimeters = (value: number) =>
  `${Number(value.toFixed(4)).toString()}mm`

const buildParameterizedString = (
  seed: string,
  parameters: Partial<Record<NumericParameter, number>>,
) => {
  const suffix = NUMERIC_PARAMETERS.flatMap((parameter) => {
    const value = parameters[parameter]
    return value === undefined
      ? []
      : [`${parameter}${formatMillimeters(value)}`]
  }).join("_")
  return suffix ? `${seed}_${suffix}` : seed
}

const geometrySignature = (preview: FootprintPreview) =>
  preview.pads
    .map((pad) =>
      [pad.kind, pad.shape, pad.x, pad.y, pad.width, pad.height, pad.rotation]
        .map(String)
        .join(":"),
    )
    .join("|")

const getPreferredFamilies = (analysis: TargetAnalysis) => {
  if (analysis.platedHoleCount > analysis.perimeterPadCount / 2) {
    return new Set([
      "dip",
      "electrolytic",
      "jst",
      "pinrow",
      "radial",
      "to220",
      "to92",
      "usbcmidmount",
    ])
  }
  if (analysis.topology === "grid") return new Set(["bga"])
  if (analysis.topology === "four-sided") {
    return new Set(["lqfp", "mlp", "qfn", "qfp", "quad", "tqfp"])
  }
  if (analysis.topology === "two-sided") {
    return new Set([
      "soic",
      "tssop",
      "ssop",
      "msop",
      "vssop",
      "dfn",
      "son",
      "sot",
    ])
  }
  if (analysis.topology === "linear" && analysis.perimeterPadCount === 2) {
    return new Set(["res", "cap", "diode", "led", "melf", "axial"])
  }
  return new Set<string>()
}

const generateSeeds = (target: FootprintPreview, analysis: TargetAnalysis) => {
  const padCount = target.pads.length
  const seeds = new Set<string>()

  for (const family of getFootprintNames()) {
    seeds.add(`${family}${padCount}`)
    // Mid-mount USB-C variants are named by their explicit 16-pin form.
    if (family !== "usbcmidmount") seeds.add(family)
  }

  if (analysis.thermalPad && analysis.perimeterPadCount > 0) {
    const thermalPadDimensions = `${formatMillimeters(
      analysis.thermalPad.width,
    )}x${formatMillimeters(analysis.thermalPad.height)}`
    for (const family of ["mlp", "qfn", "quad"]) {
      seeds.add(`${family}${analysis.perimeterPadCount}_thermalpad`)
      seeds.add(
        `${family}${analysis.perimeterPadCount}_thermalpad${thermalPadDimensions}`,
      )
    }
  }

  if (analysis.topology === "grid") {
    seeds.add(`bga${padCount}_grid${analysis.gridColumns}x${analysis.gridRows}`)
  }

  if (analysis.topology === "two-sided" && padCount % 2 === 1) {
    for (
      let missingPosition = 1;
      missingPosition <= padCount + 1;
      missingPosition += 1
    ) {
      seeds.add(`dfn${padCount + 1}_missing(${missingPosition})`)
    }
  }

  if (padCount === 2 && analysis.platedHoleCount === 0) {
    const padBounds = target.pads.map(getPadBounds)
    const passiveDimensions = `p${formatMillimeters(
      analysis.heuristics.p,
    )}_pw${formatMillimeters(
      median(padBounds.map((bound) => bound.width)),
    )}_ph${formatMillimeters(median(padBounds.map((bound) => bound.height)))}`
    seeds.add(`res_${passiveDimensions}`)
    seeds.add(`cap_${passiveDimensions}`)
    for (const size of getFootprintSizes()) {
      seeds.add(size.imperial)
      seeds.add(`cap${size.imperial}`)
      seeds.add(`res${size.imperial}`)
    }
  }

  return [...seeds]
}

const selectSeedsToOptimize = (
  candidates: SeedCandidate[],
  analysis: TargetAnalysis,
) => {
  const selected = new Map<string, SeedCandidate>()
  for (const candidate of candidates.slice(0, 4)) {
    selected.set(candidate.footprinterString, candidate)
  }

  const preferredFamilies = getPreferredFamilies(analysis)
  for (const family of preferredFamilies) {
    const candidate =
      (family === "dfn"
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_missing("),
          )
        : undefined) ??
      candidates.find(
        (entry) =>
          entry.family === family && entry.footprinterString === family,
      ) ??
      candidates.find((entry) => entry.family === family)
    if (candidate) selected.set(candidate.footprinterString, candidate)
    if (selected.size >= MAX_OPTIMIZED_SEEDS) break
  }

  return [...selected.values()].slice(0, MAX_OPTIMIZED_SEEDS)
}

const findActiveParameters = (
  seed: SeedCandidate,
  analysis: TargetAnalysis,
) => {
  const active: NumericParameter[] = []
  const baseSignature = geometrySignature(seed.preview)

  for (const parameter of NUMERIC_PARAMETERS) {
    const heuristic = Math.max(analysis.heuristics[parameter], 0.05)
    const preview = tryBuild(
      buildParameterizedString(seed.footprinterString, {
        [parameter]: heuristic,
      }),
    )
    if (
      preview &&
      preview.pads.length === seed.preview.pads.length &&
      geometrySignature(preview) !== baseSignature
    ) {
      active.push(parameter)
    }
  }

  return active
}

const optimizeSeed = (
  seed: SeedCandidate,
  target: FootprintPreview,
  analysis: TargetAnalysis,
) => {
  const activeParameters = findActiveParameters(seed, analysis)
  if (!activeParameters.length) {
    return {
      ...seed,
      optimizedParameters: {} as Partial<Record<NumericParameter, number>>,
    }
  }

  const values: Partial<Record<NumericParameter, number>> = {}
  for (const parameter of activeParameters) {
    values[parameter] = Math.max(analysis.heuristics[parameter], 0.05)
  }

  const evaluate = (parameters: Partial<Record<NumericParameter, number>>) => {
    const footprinterString = buildParameterizedString(
      seed.footprinterString,
      parameters,
    )
    const preview = tryBuild(footprinterString)
    if (!preview || preview.pads.length !== target.pads.length) {
      return null
    }
    return {
      footprinterString,
      loss: getGeometryLoss(preview, target),
      parameters: { ...parameters },
      preview,
    }
  }

  let current = evaluate(values)
  let best = current
  const firstMoments: Partial<Record<NumericParameter, number>> = {}
  const secondMoments: Partial<Record<NumericParameter, number>> = {}

  for (let iteration = 1; iteration <= OPTIMIZATION_STEPS; iteration += 1) {
    if (!current) break
    const gradients: Partial<Record<NumericParameter, number>> = {}

    for (const parameter of activeParameters) {
      const value = values[parameter] ?? 0.05
      const delta = Math.max(value * 0.035, 0.0125)
      const lowerValues = {
        ...values,
        [parameter]: Math.max(value - delta, 0.025),
      }
      const upperValues = { ...values, [parameter]: value + delta }
      const lower = evaluate(lowerValues)
      const upper = evaluate(upperValues)
      if (!lower || !upper) continue
      gradients[parameter] = (upper.loss - lower.loss) / (2 * delta)
    }

    for (const parameter of activeParameters) {
      const gradient = gradients[parameter]
      if (gradient === undefined || !Number.isFinite(gradient)) continue
      const firstMoment = 0.9 * (firstMoments[parameter] ?? 0) + 0.1 * gradient
      const secondMoment =
        0.999 * (secondMoments[parameter] ?? 0) + 0.001 * gradient * gradient
      firstMoments[parameter] = firstMoment
      secondMoments[parameter] = secondMoment
      const correctedFirstMoment = firstMoment / (1 - 0.9 ** iteration)
      const correctedSecondMoment = secondMoment / (1 - 0.999 ** iteration)
      const stepScale = Math.max(analysis.heuristics[parameter] * 0.075, 0.025)
      const currentValue = values[parameter] ?? 0.05
      const upperBound =
        Math.max(
          analysis.bounds.width,
          analysis.bounds.height,
          analysis.heuristics[parameter],
        ) * 3
      values[parameter] = clamp(
        currentValue -
          (stepScale * correctedFirstMoment) /
            (Math.sqrt(correctedSecondMoment) + 1e-8),
        0.025,
        Math.max(upperBound, 0.1),
      )
    }

    current = evaluate(values)
    if (current && (!best || current.loss < best.loss)) best = current
  }

  if (!best || seed.geometryScore >= 1 / (1 + best.loss)) {
    return {
      ...seed,
      optimizedParameters: {} as Partial<Record<NumericParameter, number>>,
    }
  }

  const simplifiedParameters = Object.fromEntries(
    Object.entries(best.parameters).map(([parameter, value]) => [
      parameter,
      Number(value.toFixed(4)),
    ]),
  ) as Partial<Record<NumericParameter, number>>
  const bestSignature = geometrySignature(best.preview)
  for (const parameter of activeParameters) {
    const withoutParameter = { ...simplifiedParameters }
    delete withoutParameter[parameter]
    const simplifiedPreview = tryBuild(
      buildParameterizedString(seed.footprinterString, withoutParameter),
    )
    if (
      simplifiedPreview &&
      geometrySignature(simplifiedPreview) === bestSignature
    ) {
      delete simplifiedParameters[parameter]
    }
  }
  const simplifiedString = buildParameterizedString(
    seed.footprinterString,
    simplifiedParameters,
  )
  const simplifiedPreview = tryBuild(simplifiedString) ?? best.preview

  return {
    family: seed.family,
    footprinterString: simplifiedString,
    geometryScore: 1 / (1 + best.loss),
    optimizedParameters: simplifiedParameters,
    preview: simplifiedPreview,
  }
}

export const discoverFootprinterString = (
  target: FootprintPreview,
  maxCandidates = 5,
): FootprinterDiscoveryResult => {
  const analysis = analyzeTarget(target)
  const rawSeeds = generateSeeds(target, analysis)
  const seedCandidates = rawSeeds.flatMap((footprinterString) => {
    const preview = tryBuild(footprinterString)
    if (!preview || preview.pads.length !== target.pads.length) return []
    const platedHoleCount = preview.pads.filter(
      (pad) => pad.kind === "plated-hole",
    ).length
    if (platedHoleCount !== analysis.platedHoleCount) return []

    return [
      {
        family: getFamily(footprinterString),
        footprinterString,
        geometryScore: getGeometryScore(preview, target),
        preview,
      },
    ]
  })
  seedCandidates.sort((left, right) => right.geometryScore - left.geometryScore)

  const selectedSeeds = selectSeedsToOptimize(seedCandidates, analysis)
  const optimized = selectedSeeds.map((seed) =>
    optimizeSeed(seed, target, analysis),
  )
  const allCandidates = [...optimized, ...seedCandidates]
    .map((candidate): FootprinterDiscoveryCandidate => {
      const copperIntersectionOverUnion = summarizeCopperComparison(
        candidate.preview,
        target,
        SEARCH_GRID_SIZE,
      ).copperIntersectionOverUnion
      const domainScore = getDomainScore(target, candidate.family)
      return {
        copperIntersectionOverUnion,
        domainScore,
        family: candidate.family,
        footprinterString: candidate.footprinterString,
        geometryScore: candidate.geometryScore,
        optimizedParameters:
          "optimizedParameters" in candidate
            ? (candidate.optimizedParameters as Partial<
                Record<NumericParameter, number>
              >)
            : {},
        rankingScore: copperIntersectionOverUnion + domainScore * 0.08,
      }
    })
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        right.copperIntersectionOverUnion - left.copperIntersectionOverUnion ||
        right.domainScore - left.domainScore ||
        right.geometryScore - left.geometryScore ||
        left.footprinterString.length - right.footprinterString.length,
    )

  const uniqueCandidates: FootprinterDiscoveryCandidate[] = []
  const seenStrings = new Set<string>()
  for (const candidate of allCandidates) {
    if (seenStrings.has(candidate.footprinterString)) continue
    seenStrings.add(candidate.footprinterString)
    uniqueCandidates.push(candidate)
    if (uniqueCandidates.length >= clamp(maxCandidates, 1, 10)) break
  }

  return {
    best: uniqueCandidates[0] ?? null,
    candidates: uniqueCandidates,
    diagnostics: {
      evaluatedSeeds: rawSeeds.length,
      optimizedSeeds: selectedSeeds.length,
      targetPadCount: target.pads.length,
      topology: analysis.topology,
    },
    target,
  }
}
