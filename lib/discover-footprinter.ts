import { getFootprintNames, getFootprintSizes } from "@tscircuit/footprinter"
import type { PcbHole, PcbPlatedHole, PcbSmtPad, Point } from "circuit-json"
import {
  type FootprintPreview,
  footprinterStringToPreview,
} from "./circuit-json-preview.js"
import { summarizeCopperComparison } from "./compare-copper.js"
import {
  type Bounds,
  getPcbHoleGeometry,
  getPcbPadGeometry,
  getShapeListBounds,
  type PcbPadGeometry,
  rotatePoint,
  type ShapeGeometry,
} from "./preview-geometry.js"

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
type FootprintRotation = 0 | 90 | 180 | 270
type Pin1Location =
  | readonly ["bottomside" | "topside", "left" | "right"]
  | readonly ["leftside" | "rightside", "bottom" | "top"]

const FOOTPRINT_ROTATIONS: FootprintRotation[] = [0, 90, 180, 270]
const PIN1_LOCATIONS: Pin1Location[] = [
  ["leftside", "top"],
  ["leftside", "bottom"],
  ["rightside", "top"],
  ["rightside", "bottom"],
  ["topside", "left"],
  ["topside", "right"],
  ["bottomside", "left"],
  ["bottomside", "right"],
]

interface TargetAnalysis {
  bounds: Bounds
  gridColumns: number
  gridRows: number
  heuristics: Record<NumericParameter, number>
  horizontalSidePadCount: number
  lgaPadLength: number
  lgaPadWidth: number
  perimeterPadCount: number
  platedHoleCount: number
  thermalPad?: {
    height: number
    width: number
  }
  topology: Topology
  verticalSidePadCount: number
}

interface SeedCandidate {
  family: string
  footprinterString: string
  geometryScore: number
  searchRotation: FootprintRotation
  preview: FootprintPreview
}

export interface FootprinterDiscoveryCandidate {
  copperIntersectionOverUnion: number
  domainScore: number
  family: string
  footprinterString: string
  geometryScore: number
  holeIntersectionOverUnion: number
  optimizedParameters: Partial<Record<NumericParameter, number>>
  rankingScore: number
}

interface RankedDiscoveryCandidate extends FootprinterDiscoveryCandidate {
  preview: FootprintPreview
  searchRotation: FootprintRotation
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

const getOrientedHeuristics = (
  seed: SeedCandidate,
  analysis: TargetAnalysis,
): Record<NumericParameter, number> => {
  const heuristics =
    seed.family === "lga"
      ? {
          ...analysis.heuristics,
          h: analysis.bounds.height,
          pl: analysis.lgaPadLength,
          pw: analysis.lgaPadWidth,
          w: analysis.bounds.width,
        }
      : analysis.heuristics
  if (seed.searchRotation !== 90 && seed.searchRotation !== 270) {
    return heuristics
  }

  return {
    ...heuristics,
    h: heuristics.w,
    w: heuristics.h,
  }
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

const getPadBounds = (pad: ShapeGeometry): Bounds => getShapeListBounds([pad])

const getBounds = (pads: ShapeGeometry[]): Bounds => getShapeListBounds(pads)

const getPadGeometries = (preview: FootprintPreview) =>
  preview.pads.map(getPcbPadGeometry)

const getCopperShapes = (preview: FootprintPreview) =>
  getPadGeometries(preview).map(({ copper }) => copper)

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

const getPitchEstimate = (pads: ShapeGeometry[], tolerance: number) => {
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
  const pads = getCopperShapes(target)
  const bounds = getBounds(pads)
  const padBounds = pads.map(getPadBounds)
  const medianPadWidth = median(padBounds.map((bound) => bound.width))
  const medianPadHeight = median(padBounds.map((bound) => bound.height))
  const tolerance = Math.max(
    Math.min(medianPadWidth, medianPadHeight) * 0.22,
    0.015,
  )
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const medianPadArea = median(
    padBounds.map((bound) => bound.width * bound.height),
  )
  const thermalPadEntry = pads
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
    )[0]
  // The exposed center pad describes heat transfer, not the lead topology.
  const topologyPads = thermalPadEntry
    ? pads.filter((pad) => pad !== thermalPadEntry.pad)
    : pads
  const topologyBounds = getBounds(topologyPads)
  const topologyCenterX = (topologyBounds.minX + topologyBounds.maxX) / 2
  const topologyCenterY = (topologyBounds.minY + topologyBounds.maxY) / 2
  const xCoordinates = clusterCoordinates(
    topologyPads.map((pad) => pad.x),
    tolerance,
  )
  const yCoordinates = clusterCoordinates(
    topologyPads.map((pad) => pad.y),
    tolerance,
  )
  const edgeToleranceX = Math.max(
    medianPadWidth * 0.75,
    topologyBounds.width * 0.08,
  )
  const edgeToleranceY = Math.max(
    medianPadHeight * 0.75,
    topologyBounds.height * 0.08,
  )
  const sidePads = topologyPads.filter(
    (pad) =>
      Math.abs(pad.x - (topologyBounds.minX + medianPadWidth / 2)) <=
        edgeToleranceX ||
      Math.abs(pad.x - (topologyBounds.maxX - medianPadWidth / 2)) <=
        edgeToleranceX ||
      Math.abs(pad.y - (topologyBounds.minY + medianPadHeight / 2)) <=
        edgeToleranceY ||
      Math.abs(pad.y - (topologyBounds.maxY - medianPadHeight / 2)) <=
        edgeToleranceY,
  )
  const minPadCenterX = Math.min(...topologyPads.map((pad) => pad.x))
  const maxPadCenterX = Math.max(...topologyPads.map((pad) => pad.x))
  const minPadCenterY = Math.min(...topologyPads.map((pad) => pad.y))
  const maxPadCenterY = Math.max(...topologyPads.map((pad) => pad.y))
  const topologyPadEntries = topologyPads.map((pad) => ({
    bounds: getPadBounds(pad),
    pad,
  }))
  const leftRightEdgePads = topologyPadEntries.filter(
    ({ pad }) =>
      Math.abs(pad.x - minPadCenterX) <= tolerance ||
      Math.abs(pad.x - maxPadCenterX) <= tolerance,
  )
  const topBottomEdgePads = topologyPadEntries.filter(
    ({ pad }) =>
      Math.abs(pad.y - minPadCenterY) <= tolerance ||
      Math.abs(pad.y - maxPadCenterY) <= tolerance,
  )
  const leftSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.x - minPadCenterX) <= edgeToleranceX &&
      bound.width >= bound.height * 0.95,
  ).length
  const rightSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.x - maxPadCenterX) <= edgeToleranceX &&
      bound.width >= bound.height * 0.95,
  ).length
  const bottomSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.y - minPadCenterY) <= edgeToleranceY &&
      bound.height >= bound.width * 0.95,
  ).length
  const topSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.y - maxPadCenterY) <= edgeToleranceY &&
      bound.height >= bound.width * 0.95,
  ).length
  const gridOccupancy =
    topologyPads.length / Math.max(xCoordinates.length * yCoordinates.length, 1)
  const hasPadsOnFourSides =
    sidePads.filter(
      (pad) => Math.abs(pad.x - topologyCenterX) > topologyBounds.width * 0.3,
    ).length >= 4 &&
    sidePads.filter(
      (pad) => Math.abs(pad.y - topologyCenterY) > topologyBounds.height * 0.3,
    ).length >= 4

  let topology: Topology = "irregular"
  if (xCoordinates.length === 1 || yCoordinates.length === 1) {
    topology = "linear"
  } else if (xCoordinates.length <= 2 || yCoordinates.length <= 2) {
    topology = "two-sided"
  } else if (
    topologyPads.length >= 4 &&
    xCoordinates.length >= 2 &&
    yCoordinates.length >= 2 &&
    gridOccupancy >= 0.68
  ) {
    topology = "grid"
  } else if (hasPadsOnFourSides && topologyPads.length >= 8) {
    topology = "four-sided"
  }

  const pitch = getPitchEstimate(pads, tolerance)
  const medianPadLongSide = median(
    padBounds.map((bound) => Math.max(bound.width, bound.height)),
  )
  const medianPadShortSide = median(
    padBounds.map((bound) => Math.min(bound.width, bound.height)),
  )
  const medianPadDiameter = median(
    padBounds.map((bound) => Math.sqrt(bound.width * bound.height)),
  )
  const medianHoleDiameter = median(
    getPadGeometries(target).flatMap((pad) =>
      pad.drill ? [Math.sqrt(pad.drill.width * pad.drill.height)] : [],
    ),
  )
  const platedHoleCount = target.pads.filter(
    (pad) => pad.type === "pcb_plated_hole",
  ).length
  const insetQuadAdjustment = topology === "four-sided" ? 0.2 : 0

  return {
    bounds,
    gridColumns: xCoordinates.length,
    gridRows: yCoordinates.length,
    heuristics: {
      ball: medianPadDiameter,
      h: bounds.height + insetQuadAdjustment,
      id: medianHoleDiameter || medianPadDiameter * 0.6,
      od: medianPadDiameter,
      p: pitch,
      pad: medianPadDiameter,
      ph: medianPadHeight,
      pl: medianPadLongSide,
      pw: medianPadShortSide,
      w: bounds.width + insetQuadAdjustment,
    },
    horizontalSidePadCount: Math.max(leftSidePadCount, rightSidePadCount),
    lgaPadLength: leftRightEdgePads.length
      ? median(leftRightEdgePads.map(({ bounds: bound }) => bound.width))
      : median(topBottomEdgePads.map(({ bounds: bound }) => bound.height)),
    lgaPadWidth: leftRightEdgePads.length
      ? median(leftRightEdgePads.map(({ bounds: bound }) => bound.height))
      : median(topBottomEdgePads.map(({ bounds: bound }) => bound.width)),
    perimeterPadCount: sidePads.length,
    platedHoleCount,
    thermalPad: thermalPadEntry
      ? {
          height: thermalPadEntry.bound.height,
          width: thermalPadEntry.bound.width,
        }
      : undefined,
    topology,
    verticalSidePadCount: Math.max(bottomSidePadCount, topSidePadCount),
  }
}

const normalizePads = (pads: PcbPadGeometry[]) => {
  const bounds = getBounds(pads.map(({ copper }) => copper))
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return pads.map((pad) => ({
    ...pad,
    copper: {
      ...pad.copper,
      x: pad.copper.x - centerX,
      y: pad.copper.y - centerY,
    },
    drill: pad.drill
      ? {
          ...pad.drill,
          x: pad.drill.x - centerX,
          y: pad.drill.y - centerY,
        }
      : undefined,
  }))
}

const rotateCoordinates = (point: Point, rotation: FootprintRotation) =>
  rotatePoint(point.x, point.y, (rotation * Math.PI) / 180)

const rotateSmtPad = (
  pad: PcbSmtPad,
  rotation: FootprintRotation,
): PcbSmtPad => {
  if (rotation === 0) return pad
  if (pad.shape === "polygon") {
    return {
      ...pad,
      points: pad.points.map((point) => rotateCoordinates(point, rotation)),
    }
  }

  const position = rotateCoordinates(pad, rotation)
  switch (pad.shape) {
    case "circle":
      return { ...pad, ...position }
    case "rect":
      return {
        ...pad,
        ...position,
        ccw_rotation: rotation,
        shape: "rotated_rect",
      }
    case "pill":
      return {
        ...pad,
        ...position,
        ccw_rotation: rotation,
        shape: "rotated_pill",
      }
    case "rotated_rect":
    case "rotated_pill":
      return {
        ...pad,
        ...position,
        ccw_rotation: (pad.ccw_rotation + rotation) % 360,
      }
  }
}

const rotatePlatedHole = (
  pad: PcbPlatedHole,
  rotation: FootprintRotation,
): PcbPlatedHole => {
  if (rotation === 0) return pad
  const position = rotateCoordinates(pad, rotation)

  switch (pad.shape) {
    case "circle":
      return { ...pad, ...position }
    case "oval":
    case "pill":
      return {
        ...pad,
        ...position,
        ccw_rotation: (pad.ccw_rotation + rotation) % 360,
      }
    case "circular_hole_with_rect_pad": {
      const offset = rotateCoordinates(
        { x: pad.hole_offset_x, y: pad.hole_offset_y },
        rotation,
      )
      return {
        ...pad,
        ...position,
        hole_offset_x: offset.x,
        hole_offset_y: offset.y,
        rect_ccw_rotation: ((pad.rect_ccw_rotation ?? 0) + rotation) % 360,
      }
    }
    case "pill_hole_with_rect_pad": {
      const offset = rotateCoordinates(
        { x: pad.hole_offset_x, y: pad.hole_offset_y },
        rotation,
      )
      return {
        ...pad,
        ...position,
        ...(rotation === 90 || rotation === 270
          ? {
              hole_height: pad.hole_width,
              hole_width: pad.hole_height,
              rect_pad_height: pad.rect_pad_width,
              rect_pad_width: pad.rect_pad_height,
            }
          : {}),
        hole_offset_x: offset.x,
        hole_offset_y: offset.y,
      }
    }
    case "rotated_pill_hole_with_rect_pad": {
      const offset = rotateCoordinates(
        { x: pad.hole_offset_x, y: pad.hole_offset_y },
        rotation,
      )
      return {
        ...pad,
        ...position,
        hole_ccw_rotation: (pad.hole_ccw_rotation + rotation) % 360,
        hole_offset_x: offset.x,
        hole_offset_y: offset.y,
        rect_ccw_rotation: (pad.rect_ccw_rotation + rotation) % 360,
      }
    }
    case "hole_with_polygon_pad": {
      const offset = rotateCoordinates(
        { x: pad.hole_offset_x, y: pad.hole_offset_y },
        rotation,
      )
      return {
        ...pad,
        ...position,
        ccw_rotation:
          pad.hole_shape === "rotated_pill"
            ? ((pad.ccw_rotation ?? 0) + rotation) % 360
            : pad.ccw_rotation,
        hole_offset_x: offset.x,
        hole_offset_y: offset.y,
        pad_outline: pad.pad_outline.map((point) =>
          rotateCoordinates(point, rotation),
        ),
      }
    }
  }
}

const rotateHole = (hole: PcbHole, rotation: FootprintRotation): PcbHole => {
  if (rotation === 0) return hole
  const { x, y } = rotateCoordinates(hole, rotation)

  switch (hole.hole_shape) {
    case "circle":
      return {
        hole_diameter: hole.hole_diameter,
        hole_shape: "circle",
        pcb_hole_id: hole.pcb_hole_id,
        type: "pcb_hole",
        x,
        y,
      }
    case "square":
      return {
        hole_diameter: hole.hole_diameter,
        hole_shape: "square",
        pcb_hole_id: hole.pcb_hole_id,
        type: "pcb_hole",
        x,
        y,
      }
    case "rect":
      return {
        hole_height:
          rotation === 90 || rotation === 270
            ? hole.hole_width
            : hole.hole_height,
        hole_shape: "rect",
        hole_width:
          rotation === 90 || rotation === 270
            ? hole.hole_height
            : hole.hole_width,
        pcb_hole_id: hole.pcb_hole_id,
        type: "pcb_hole",
        x,
        y,
      }
    case "oval":
      return {
        hole_height:
          rotation === 90 || rotation === 270
            ? hole.hole_width
            : hole.hole_height,
        hole_shape: "oval",
        hole_width:
          rotation === 90 || rotation === 270
            ? hole.hole_height
            : hole.hole_width,
        pcb_hole_id: hole.pcb_hole_id,
        type: "pcb_hole",
        x,
        y,
      }
    case "pill":
      return {
        ccw_rotation: rotation,
        hole_height: hole.hole_height,
        hole_shape: "rotated_pill",
        hole_width: hole.hole_width,
        pcb_hole_id: hole.pcb_hole_id,
        type: "pcb_hole",
        x,
        y,
      }
    case "rotated_pill":
      return {
        ccw_rotation: (hole.ccw_rotation + rotation) % 360,
        hole_height: hole.hole_height,
        hole_shape: "rotated_pill",
        hole_width: hole.hole_width,
        pcb_hole_id: hole.pcb_hole_id,
        type: "pcb_hole",
        x,
        y,
      }
  }
}

export const rotateFootprint = (
  footprint: FootprintPreview,
  rotation: FootprintRotation,
): FootprintPreview => {
  if (rotation === 0) return footprint
  return {
    ...footprint,
    holes: footprint.holes.map((hole) => rotateHole(hole, rotation)),
    pads: footprint.pads.map((pad) =>
      pad.type === "pcb_smtpad"
        ? rotateSmtPad(pad, rotation)
        : rotatePlatedHole(pad, rotation),
    ),
  }
}

const getOrientedPadSize = (pad: PcbPadGeometry) => {
  const bounds = getShapeListBounds([{ ...pad.copper, x: 0, y: 0 }])
  return { height: bounds.height, width: bounds.width }
}

const matchPadsByPosition = (
  left: PcbPadGeometry[],
  right: PcbPadGeometry[],
) => {
  const availableRight = new Set(right.map((_, index) => index))
  return left.map((leftPad) => {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const rightIndex of availableRight) {
      const rightPad = right[rightIndex]
      const distance = Math.hypot(
        leftPad.copper.x - rightPad.copper.x,
        leftPad.copper.y - rightPad.copper.y,
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

const normalizePortHint = (hint: string) => {
  const trimmed = hint.trim()
  const numericPin = trimmed.match(/^(?:pin)?(\d+)$/i)
  return numericPin ? `pin${numericPin[1]}` : trimmed
}

const getPortHints = ({ element }: PcbPadGeometry) =>
  (element.port_hints ?? []).map(normalizePortHint)

const getGeometryLoss = (
  candidate: FootprintPreview,
  target: FootprintPreview,
) => {
  if (candidate.pads.length !== target.pads.length) return 1_000

  const candidatePads = normalizePads(getPadGeometries(candidate))
  const targetPads = normalizePads(getPadGeometries(target))
  const targetBounds = getBounds(targetPads.map(({ copper }) => copper))
  const positionScale = Math.max(
    Math.hypot(targetBounds.width, targetBounds.height),
    0.1,
  )
  const pairs = matchPadsByPosition(candidatePads, targetPads)
  let loss = 0

  for (const [candidatePad, targetPad] of pairs) {
    const candidateSize = getOrientedPadSize(candidatePad)
    const targetSize = getOrientedPadSize(targetPad)
    const dx = (candidatePad.copper.x - targetPad.copper.x) / positionScale
    const dy = (candidatePad.copper.y - targetPad.copper.y) / positionScale
    const dw =
      (candidateSize.width - targetSize.width) /
      Math.max(targetSize.width, 0.05)
    const dh =
      (candidateSize.height - targetSize.height) /
      Math.max(targetSize.height, 0.05)

    loss += dx * dx * 4 + dy * dy * 4 + dw * dw + dh * dh
    if (candidatePad.element.type !== targetPad.element.type) loss += 4
    if (candidatePad.copper.shape !== targetPad.copper.shape) loss += 0.08
    if (Boolean(candidatePad.drill) !== Boolean(targetPad.drill)) {
      loss += 4
    } else if (candidatePad.drill && targetPad.drill) {
      const holeWidthScale = Math.max(targetPad.drill.width, 0.05)
      const holeHeightScale = Math.max(targetPad.drill.height, 0.05)
      const holeWidthDifference =
        (candidatePad.drill.width - targetPad.drill.width) / holeWidthScale
      const holeHeightDifference =
        (candidatePad.drill.height - targetPad.drill.height) / holeHeightScale
      const holeOffsetXDifference =
        (candidatePad.drill.x -
          candidatePad.copper.x -
          (targetPad.drill.x - targetPad.copper.x)) /
        positionScale
      const holeOffsetYDifference =
        (candidatePad.drill.y -
          candidatePad.copper.y -
          (targetPad.drill.y - targetPad.copper.y)) /
        positionScale

      loss +=
        holeWidthDifference * holeWidthDifference +
        holeHeightDifference * holeHeightDifference +
        holeOffsetXDifference * holeOffsetXDifference * 4 +
        holeOffsetYDifference * holeOffsetYDifference * 4
      if (candidatePad.drill.shape !== targetPad.drill.shape) loss += 0.08
    }
    const targetPortHints = getPortHints(targetPad)
    if (
      targetPortHints.length > 0 &&
      !getPortHints(candidatePad).some((hint) => targetPortHints.includes(hint))
    ) {
      loss += 0.04
    }
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
    lga: ["lga"],
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

const geometrySignature = (preview: FootprintPreview) => {
  const padSignature = getPadGeometries(preview)
    .map(({ copper, drill, element }) => {
      const holeSignature = drill
        ? [
            drill.shape,
            drill.x - copper.x,
            drill.y - copper.y,
            drill.width,
            drill.height,
            drill.rotation,
          ].join(":")
        : "no-hole"
      const pointSignature =
        copper.shape === "polygon"
          ? copper.points?.map((point) => `${point.x}:${point.y}`).join(",")
          : "no-points"
      return [
        element.type,
        copper.shape,
        copper.x,
        copper.y,
        copper.width,
        copper.height,
        copper.rotation,
        pointSignature,
        holeSignature,
      ]
        .map(String)
        .join(":")
    })
    .join("|")
  const holeSignature = preview.holes
    .map(getPcbHoleGeometry)
    .map((hole) =>
      [hole.shape, hole.x, hole.y, hole.width, hole.height, hole.rotation].join(
        ":",
      ),
    )
    .join("|")
  return `${padSignature}#${holeSignature}`
}

const padShapeSignature = (preview: FootprintPreview) =>
  getPadGeometries(preview)
    .map(({ copper, element }) => `${element.type}:${copper.shape}`)
    .toSorted()
    .join("|")

const areClose = (left: number, right: number) =>
  Math.abs(left - right) <= 0.00001

// Geometry has already been matched before orientation is encoded. At this
// point only pad/hole placement and pin identity determine pin1location.
const haveSamePadPlacement = (
  left: FootprintPreview,
  right: FootprintPreview,
) => {
  if (
    left.pads.length !== right.pads.length ||
    left.holes.length !== right.holes.length
  ) {
    return false
  }

  const leftPads = getPadGeometries(left)
  const rightPads = getPadGeometries(right)
  const padsMatch = leftPads.every((leftPad, index) => {
    const rightPad = rightPads[index]
    if (!rightPad) return false
    return (
      leftPad.element.type === rightPad.element.type &&
      getPortHints(leftPad).join("|") === getPortHints(rightPad).join("|") &&
      areClose(leftPad.copper.x, rightPad.copper.x) &&
      areClose(leftPad.copper.y, rightPad.copper.y)
    )
  })
  if (!padsMatch) return false

  const leftHoles = left.holes.map(getPcbHoleGeometry)
  const rightHoles = right.holes.map(getPcbHoleGeometry)
  return leftHoles.every((leftHole, index) => {
    const rightHole = rightHoles[index]
    if (!rightHole) return false
    return (
      areClose(leftHole.x, rightHole.x) && areClose(leftHole.y, rightHole.y)
    )
  })
}

const encodeOrientationInFootprinterString = (
  footprinterString: string,
  searchRotation: FootprintRotation,
  orientedPreview: FootprintPreview,
) => {
  if (searchRotation === 0) return footprinterString

  for (const [side, alignment] of PIN1_LOCATIONS) {
    const orientedString = `${footprinterString}_pin1location(${side},${alignment})`
    const preview = tryBuild(orientedString)
    if (preview && haveSamePadPlacement(preview, orientedPreview)) {
      return orientedString
    }
  }

  return null
}

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
    return new Set(["lga", "lqfp", "mlp", "qfn", "qfp", "quad", "tqfp"])
  }
  if (analysis.topology === "two-sided") {
    return new Set([
      "lga",
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
    // A 90-degree candidate rotation also rotates a non-square thermal pad.
    // Generate both source orientations so one remains aligned to the target.
    const thermalPadDimensionOptions = new Set([
      `${formatMillimeters(analysis.thermalPad.width)}x${formatMillimeters(
        analysis.thermalPad.height,
      )}`,
      `${formatMillimeters(analysis.thermalPad.height)}x${formatMillimeters(
        analysis.thermalPad.width,
      )}`,
    ])
    const thermalPadFamilies =
      analysis.topology === "two-sided"
        ? ["dfn", "msop", "soic", "ssop", "tssop", "vssop"]
        : ["mlp", "qfn", "quad"]
    for (const family of thermalPadFamilies) {
      seeds.add(`${family}${analysis.perimeterPadCount}_thermalpad`)
      for (const thermalPadDimensions of thermalPadDimensionOptions) {
        seeds.add(
          `${family}${analysis.perimeterPadCount}_thermalpad${thermalPadDimensions}`,
        )
      }
    }
  }

  if (analysis.topology === "grid") {
    seeds.add(`bga${padCount}_grid${analysis.gridColumns}x${analysis.gridRows}`)
  }

  if (
    analysis.topology === "four-sided" &&
    2 * (analysis.horizontalSidePadCount + analysis.verticalSidePadCount) ===
      analysis.perimeterPadCount
  ) {
    seeds.add(
      `lga${analysis.perimeterPadCount}_grid${analysis.horizontalSidePadCount}x${analysis.verticalSidePadCount}`,
    )
  }

  const hasLgaHint = target.sourceHints?.some((hint) =>
    hint.toLowerCase().includes("lga"),
  )
  if (analysis.topology === "two-sided" && hasLgaHint) {
    const padsPerSide = analysis.perimeterPadCount / 2
    if (Number.isInteger(padsPerSide)) {
      const grid =
        analysis.gridColumns <= 2 ? `${padsPerSide}x0` : `0x${padsPerSide}`
      seeds.add(`lga${analysis.perimeterPadCount}_grid${grid}`)
    }
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
    const padBounds = getCopperShapes(target).map(getPadBounds)
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

  if (getCopperShapes(target).some((pad) => pad.shape === "pill")) {
    for (const seed of [...seeds]) {
      const pillPadSeed = `${seed}_pillpads`
      const preview = tryBuild(pillPadSeed)
      if (
        preview?.pads.length === padCount &&
        getCopperShapes(preview).some((pad) => pad.shape === "pill")
      ) {
        seeds.add(pillPadSeed)
      }
    }
  }

  return [...seeds]
}

const selectSeedsToOptimize = (
  candidates: SeedCandidate[],
  analysis: TargetAnalysis,
  target: FootprintPreview,
) => {
  const selected = new Map<string, SeedCandidate>()
  const targetPadShapeSignature = padShapeSignature(target)
  const selectedShapeFamilies = new Set<string>()

  if (analysis.topology === "four-sided" || analysis.topology === "two-sided") {
    const lgaGridCandidate = candidates.find(
      (candidate) =>
        candidate.family === "lga" &&
        candidate.footprinterString.includes("_grid") &&
        candidate.searchRotation === 0,
    )
    if (lgaGridCandidate) {
      selected.set(
        `${lgaGridCandidate.footprinterString}:${lgaGridCandidate.searchRotation}`,
        lgaGridCandidate,
      )
    }
  }

  if (getCopperShapes(target).some((pad) => pad.shape === "pill")) {
    for (const candidate of candidates) {
      if (padShapeSignature(candidate.preview) !== targetPadShapeSignature) {
        continue
      }
      if (selectedShapeFamilies.has(candidate.family)) continue
      selectedShapeFamilies.add(candidate.family)
      selected.set(
        `${candidate.footprinterString}:${candidate.searchRotation}`,
        candidate,
      )
      if (selected.size >= 4) break
    }
  }

  for (const candidate of candidates.slice(0, 4)) {
    selected.set(
      `${candidate.footprinterString}:${candidate.searchRotation}`,
      candidate,
    )
  }

  const preferredFamilies = getPreferredFamilies(analysis)
  for (const family of preferredFamilies) {
    const candidate =
      (analysis.thermalPad
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_thermalpad"),
          )
        : undefined) ??
      (family === "dfn"
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_missing("),
          )
        : undefined) ??
      (family === "lga"
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_grid"),
          )
        : undefined) ??
      candidates.find(
        (entry) =>
          entry.family === family && entry.footprinterString === family,
      ) ??
      candidates.find((entry) => entry.family === family)
    if (candidate) {
      selected.set(
        `${candidate.footprinterString}:${candidate.searchRotation}`,
        candidate,
      )
    }
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
  const heuristics = getOrientedHeuristics(seed, analysis)

  for (const parameter of NUMERIC_PARAMETERS) {
    const heuristic = Math.max(heuristics[parameter], 0.05)
    const preview = tryBuild(
      buildParameterizedString(seed.footprinterString, {
        [parameter]: heuristic,
      }),
    )
    const orientedPreview = preview
      ? rotateFootprint(preview, seed.searchRotation)
      : null
    if (
      orientedPreview &&
      orientedPreview.pads.length === seed.preview.pads.length &&
      geometrySignature(orientedPreview) !== baseSignature
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
  const heuristics = getOrientedHeuristics(seed, analysis)
  for (const parameter of activeParameters) {
    values[parameter] = Math.max(heuristics[parameter], 0.05)
  }

  const evaluate = (parameters: Partial<Record<NumericParameter, number>>) => {
    const footprinterString = buildParameterizedString(
      seed.footprinterString,
      parameters,
    )
    const unrotatedPreview = tryBuild(footprinterString)
    if (!unrotatedPreview) return null
    const preview = rotateFootprint(unrotatedPreview, seed.searchRotation)
    if (preview.pads.length !== target.pads.length) {
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
      const stepScale = Math.max(heuristics[parameter] * 0.075, 0.025)
      const currentValue = values[parameter] ?? 0.05
      const upperBound =
        Math.max(
          analysis.bounds.width,
          analysis.bounds.height,
          heuristics[parameter],
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
    const orientedSimplifiedPreview = simplifiedPreview
      ? rotateFootprint(simplifiedPreview, seed.searchRotation)
      : null
    if (
      orientedSimplifiedPreview &&
      geometrySignature(orientedSimplifiedPreview) === bestSignature
    ) {
      delete simplifiedParameters[parameter]
    }
  }
  const simplifiedString = buildParameterizedString(
    seed.footprinterString,
    simplifiedParameters,
  )
  const unrotatedSimplifiedPreview = tryBuild(simplifiedString)
  const simplifiedPreview = unrotatedSimplifiedPreview
    ? rotateFootprint(unrotatedSimplifiedPreview, seed.searchRotation)
    : best.preview

  return {
    family: seed.family,
    footprinterString: simplifiedString,
    geometryScore: 1 / (1 + best.loss),
    optimizedParameters: simplifiedParameters,
    searchRotation: seed.searchRotation,
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
    const unrotatedPreview = tryBuild(footprinterString)
    if (
      !unrotatedPreview ||
      unrotatedPreview.pads.length !== target.pads.length
    ) {
      return []
    }

    return FOOTPRINT_ROTATIONS.flatMap((searchRotation): SeedCandidate[] => {
      const preview = rotateFootprint(unrotatedPreview, searchRotation)
      const platedHoleCount = preview.pads.filter(
        (pad) => pad.type === "pcb_plated_hole",
      ).length
      if (platedHoleCount !== analysis.platedHoleCount) return []

      return [
        {
          family: getFamily(footprinterString),
          footprinterString,
          geometryScore: getGeometryScore(preview, target),
          preview,
          searchRotation,
        },
      ]
    })
  })
  seedCandidates.sort(
    (left, right) =>
      right.geometryScore - left.geometryScore ||
      left.searchRotation - right.searchRotation,
  )

  const selectedSeeds = selectSeedsToOptimize(seedCandidates, analysis, target)
  const optimized = selectedSeeds.map((seed) =>
    optimizeSeed(seed, target, analysis),
  )
  const targetPadShapeSignature = padShapeSignature(target)
  const allCandidates = [...optimized, ...seedCandidates]
    .map((candidate): RankedDiscoveryCandidate => {
      const { copperIntersectionOverUnion, holeIntersectionOverUnion } =
        summarizeCopperComparison(candidate.preview, target, SEARCH_GRID_SIZE)
      const domainScore = getDomainScore(target, candidate.family)
      const shapesMatch =
        padShapeSignature(candidate.preview) === targetPadShapeSignature
      return {
        copperIntersectionOverUnion,
        domainScore,
        family: candidate.family,
        footprinterString: candidate.footprinterString,
        geometryScore: candidate.geometryScore,
        holeIntersectionOverUnion,
        optimizedParameters:
          "optimizedParameters" in candidate
            ? (candidate.optimizedParameters as Partial<
                Record<NumericParameter, number>
              >)
            : {},
        preview: candidate.preview,
        // Package-name hints can disambiguate equivalent geometry, but should
        // not outrank a shape-exact candidate.
        rankingScore:
          copperIntersectionOverUnion +
          (holeIntersectionOverUnion - 1) * 0.12 +
          domainScore * (shapesMatch ? 0.08 : 0.01),
        searchRotation: candidate.searchRotation,
      }
    })
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        right.copperIntersectionOverUnion - left.copperIntersectionOverUnion ||
        right.holeIntersectionOverUnion - left.holeIntersectionOverUnion ||
        right.domainScore - left.domainScore ||
        right.geometryScore - left.geometryScore ||
        left.searchRotation - right.searchRotation ||
        left.footprinterString.length - right.footprinterString.length,
    )

  const uniqueCandidates: FootprinterDiscoveryCandidate[] = []
  const seenStrings = new Set<string>()
  for (const candidate of allCandidates) {
    const orientedString = encodeOrientationInFootprinterString(
      candidate.footprinterString,
      candidate.searchRotation,
      candidate.preview,
    )
    if (!orientedString || seenStrings.has(orientedString)) continue
    seenStrings.add(orientedString)
    const {
      preview: _preview,
      searchRotation: _searchRotation,
      ...publicData
    } = candidate
    uniqueCandidates.push({
      ...publicData,
      footprinterString: orientedString,
    })
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
