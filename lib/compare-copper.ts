import { getBoundsCenter, isPointInsidePolygon } from "@tscircuit/math-utils"
import type { FootprintPreview, PreviewPad } from "./circuit-json-preview.js"
import {
  type Bounds,
  getFootprintBounds,
  type PreviewShape,
  rotatePoint,
  toRadians,
} from "./preview-geometry.js"

export type { Bounds, PreviewShape } from "./preview-geometry.js"
export { getFootprintBounds } from "./preview-geometry.js"

const DEFAULT_GRID_SIZE = 320

export interface CopperComparisonSummary {
  copperIntersectionOverUnion: number
  holeIntersectionOverUnion: number
}

export interface RasterComparison {
  coverageLeft: number
  coverageRight: number
  gridSize: number
  iou: number
  leftOnlyRatio: number
  normalizedLeft: FootprintPreview
  normalizedRight: FootprintPreview
  occupancy: Uint8Array
  padCountMatch: boolean
  rightOnlyRatio: number
}

interface RasterizedShapes {
  coverageLeft: number
  coverageRight: number
  iou: number
  leftOnlyRatio: number
  occupancy?: Uint8Array
  rightOnlyRatio: number
}

const addPadding = (bounds: Bounds): Bounds => {
  const padX = Math.max(bounds.width * 0.18, 0.65)
  const padY = Math.max(bounds.height * 0.18, 0.65)

  return {
    height: bounds.height + padY * 2,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    width: bounds.width + padX * 2,
  }
}

const translateFootprint = (
  footprint: FootprintPreview,
  deltaX: number,
  deltaY: number,
): FootprintPreview => ({
  ...footprint,
  pads: footprint.pads.map((pad) => ({
    ...pad,
    x: pad.x + deltaX,
    y: pad.y + deltaY,
  })),
})

const centerFootprint = (footprint: FootprintPreview): FootprintPreview => {
  const bounds = getFootprintBounds(footprint.pads)
  const center = getBoundsCenter(bounds)
  return translateFootprint(footprint, -center.x, -center.y)
}

const getHoleShapes = (pads: readonly PreviewPad[]): PreviewShape[] =>
  pads.flatMap((pad) => {
    if (!pad.hole) return []
    return [
      {
        height: pad.hole.height,
        rotation: pad.hole.rotation,
        shape: pad.hole.shape,
        width: pad.hole.width,
        x: pad.x + pad.hole.offsetX,
        y: pad.y + pad.hole.offsetY,
      },
    ]
  })

const pointInShape = (x: number, y: number, shape: PreviewShape) => {
  const dx = x - shape.x
  const dy = y - shape.y
  const local = rotatePoint(dx, dy, -toRadians(shape.rotation))
  const halfWidth = shape.width / 2
  const halfHeight = shape.height / 2

  if (shape.shape === "polygon") {
    if (!shape.points || shape.points.length < 3) {
      throw new Error("Polygon preview shapes require at least three points")
    }
    return isPointInsidePolygon(local, shape.points)
  }

  if (shape.shape === "circle") {
    return Math.hypot(local.x, local.y) <= Math.min(halfWidth, halfHeight)
  }

  if (shape.shape === "rect") {
    const cornerRadius = Math.max(
      0,
      Math.min(shape.cornerRadius ?? 0, halfWidth, halfHeight),
    )

    if (cornerRadius === 0) {
      return Math.abs(local.x) <= halfWidth && Math.abs(local.y) <= halfHeight
    }

    const absX = Math.abs(local.x)
    const absY = Math.abs(local.y)
    const innerHalfWidth = halfWidth - cornerRadius
    const innerHalfHeight = halfHeight - cornerRadius

    if (absX <= innerHalfWidth && absY <= halfHeight) return true
    if (absX <= halfWidth && absY <= innerHalfHeight) return true

    const cornerDx = absX - innerHalfWidth
    const cornerDy = absY - innerHalfHeight

    return (
      cornerDx >= 0 &&
      cornerDy >= 0 &&
      cornerDx * cornerDx + cornerDy * cornerDy <= cornerRadius * cornerRadius
    )
  }

  if (shape.width >= shape.height) {
    const capsuleLength = halfWidth - halfHeight
    if (Math.abs(local.x) <= capsuleLength && Math.abs(local.y) <= halfHeight) {
      return true
    }

    return (
      Math.hypot(local.x - capsuleLength, local.y) <= halfHeight ||
      Math.hypot(local.x + capsuleLength, local.y) <= halfHeight
    )
  }

  const capsuleLength = halfHeight - halfWidth
  if (Math.abs(local.y) <= capsuleLength && Math.abs(local.x) <= halfWidth) {
    return true
  }

  return (
    Math.hypot(local.x, local.y - capsuleLength) <= halfWidth ||
    Math.hypot(local.x, local.y + capsuleLength) <= halfWidth
  )
}

const mergeBounds = (left: Bounds, right: Bounds): Bounds => {
  const minX = Math.min(left.minX, right.minX)
  const minY = Math.min(left.minY, right.minY)
  const maxX = Math.max(left.maxX, right.maxX)
  const maxY = Math.max(left.maxY, right.maxY)

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}

const getComparisonBounds = (
  left: readonly PreviewShape[],
  right: readonly PreviewShape[],
) => {
  if (!left.length) return addPadding(getFootprintBounds(right))
  if (!right.length) return addPadding(getFootprintBounds(left))
  return addPadding(
    mergeBounds(getFootprintBounds(left), getFootprintBounds(right)),
  )
}

const rasterizeShapes = (
  left: readonly PreviewShape[],
  right: readonly PreviewShape[],
  gridSize: number,
  includeOccupancy: boolean,
): RasterizedShapes => {
  const bounds = getComparisonBounds(left, right)
  const cellWidth = bounds.width / gridSize
  const cellHeight = bounds.height / gridSize
  const occupancy = includeOccupancy
    ? new Uint8Array(gridSize * gridSize)
    : undefined

  let leftCount = 0
  let rightCount = 0
  let overlapCount = 0

  for (let row = 0; row < gridSize; row += 1) {
    const sampleY = bounds.maxY - (row + 0.5) * cellHeight

    for (let column = 0; column < gridSize; column += 1) {
      const sampleX = bounds.minX + (column + 0.5) * cellWidth
      const inLeft = left.some((shape) => pointInShape(sampleX, sampleY, shape))
      const inRight = right.some((shape) =>
        pointInShape(sampleX, sampleY, shape),
      )

      if (inLeft) leftCount += 1
      if (inRight) rightCount += 1
      if (inLeft && inRight) overlapCount += 1

      if (occupancy) {
        const index = row * gridSize + column
        occupancy[index] = inLeft && inRight ? 3 : inLeft ? 1 : inRight ? 2 : 0
      }
    }
  }

  const unionCount = leftCount + rightCount - overlapCount

  return {
    coverageLeft: leftCount === 0 ? 0 : overlapCount / leftCount,
    coverageRight: rightCount === 0 ? 0 : overlapCount / rightCount,
    iou: unionCount === 0 ? 0 : overlapCount / unionCount,
    leftOnlyRatio:
      unionCount === 0 ? 0 : Math.max(leftCount - overlapCount, 0) / unionCount,
    occupancy,
    rightOnlyRatio:
      unionCount === 0
        ? 0
        : Math.max(rightCount - overlapCount, 0) / unionCount,
  }
}

const compareNormalizedFootprints = (
  left: FootprintPreview,
  right: FootprintPreview,
  gridSize: number,
  includeOccupancy: boolean,
) => {
  const normalizedLeft = centerFootprint(left)
  const normalizedRight = centerFootprint(right)
  const comparison = rasterizeShapes(
    normalizedLeft.pads,
    normalizedRight.pads,
    gridSize,
    includeOccupancy,
  )

  return { comparison, normalizedLeft, normalizedRight }
}

export const compareFootprints = (
  left: FootprintPreview,
  right: FootprintPreview,
  gridSize = DEFAULT_GRID_SIZE,
): RasterComparison => {
  const { comparison, normalizedLeft, normalizedRight } =
    compareNormalizedFootprints(left, right, gridSize, true)

  return {
    coverageLeft: comparison.coverageLeft,
    coverageRight: comparison.coverageRight,
    gridSize,
    iou: comparison.iou,
    leftOnlyRatio: comparison.leftOnlyRatio,
    normalizedLeft,
    normalizedRight,
    occupancy: comparison.occupancy ?? new Uint8Array(gridSize * gridSize),
    padCountMatch: normalizedLeft.pads.length === normalizedRight.pads.length,
    rightOnlyRatio: comparison.rightOnlyRatio,
  }
}

export const summarizeCopperComparison = (
  left: FootprintPreview,
  right: FootprintPreview,
  gridSize = DEFAULT_GRID_SIZE,
): CopperComparisonSummary => {
  const { comparison, normalizedLeft, normalizedRight } =
    compareNormalizedFootprints(left, right, gridSize, false)
  const leftHoles = getHoleShapes(normalizedLeft.pads)
  const rightHoles = getHoleShapes(normalizedRight.pads)
  const holeIntersectionOverUnion =
    leftHoles.length === 0 && rightHoles.length === 0
      ? 1
      : rasterizeShapes(leftHoles, rightHoles, gridSize, false).iou

  return {
    copperIntersectionOverUnion: comparison.iou,
    holeIntersectionOverUnion,
  }
}
