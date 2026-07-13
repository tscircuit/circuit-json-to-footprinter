import type { FootprintPreview, PreviewPad } from "./circuit-json-preview.js"

const DEFAULT_GRID_SIZE = 320

interface Bounds {
  height: number
  maxX: number
  maxY: number
  minX: number
  minY: number
  width: number
}

export interface CopperComparisonSummary {
  copperIntersectionOverUnion: number
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

const rotatePoint = (x: number, y: number, radians: number) => ({
  x: x * Math.cos(radians) - y * Math.sin(radians),
  y: x * Math.sin(radians) + y * Math.cos(radians),
})

const getPadBounds = (pad: PreviewPad): Bounds => {
  const halfWidth = pad.width / 2
  const halfHeight = pad.height / 2
  const radians = toRadians(pad.rotation)
  const corners = [
    rotatePoint(-halfWidth, -halfHeight, radians),
    rotatePoint(halfWidth, -halfHeight, radians),
    rotatePoint(halfWidth, halfHeight, radians),
    rotatePoint(-halfWidth, halfHeight, radians),
  ].map((corner) => ({
    x: corner.x + pad.x,
    y: corner.y + pad.y,
  }))

  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}

const getFootprintBounds = (pads: PreviewPad[]): Bounds => {
  if (!pads.length) {
    return {
      height: 1,
      maxX: 0.5,
      maxY: 0.5,
      minX: -0.5,
      minY: -0.5,
      width: 1,
    }
  }

  const bounds = pads.map(getPadBounds)
  const minX = Math.min(...bounds.map((bound) => bound.minX))
  const minY = Math.min(...bounds.map((bound) => bound.minY))
  const maxX = Math.max(...bounds.map((bound) => bound.maxX))
  const maxY = Math.max(...bounds.map((bound) => bound.maxY))

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
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
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return translateFootprint(footprint, -centerX, -centerY)
}

const pointInPad = (x: number, y: number, pad: PreviewPad) => {
  const dx = x - pad.x
  const dy = y - pad.y
  const local = rotatePoint(dx, dy, -toRadians(pad.rotation))
  const halfWidth = pad.width / 2
  const halfHeight = pad.height / 2

  if (pad.shape === "circle") {
    return Math.hypot(local.x, local.y) <= Math.min(halfWidth, halfHeight)
  }

  if (pad.shape === "rect") {
    const cornerRadius = Math.max(
      0,
      Math.min(pad.cornerRadius ?? 0, halfWidth, halfHeight),
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

  if (pad.width >= pad.height) {
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

export const summarizeCopperComparison = (
  left: FootprintPreview,
  right: FootprintPreview,
  gridSize = DEFAULT_GRID_SIZE,
): CopperComparisonSummary => {
  const normalizedLeft = centerFootprint(left)
  const normalizedRight = centerFootprint(right)
  const bounds = addPadding(
    mergeBounds(
      getFootprintBounds(normalizedLeft.pads),
      getFootprintBounds(normalizedRight.pads),
    ),
  )
  const cellWidth = bounds.width / gridSize
  const cellHeight = bounds.height / gridSize

  let leftCount = 0
  let rightCount = 0
  let overlapCount = 0

  for (let row = 0; row < gridSize; row += 1) {
    const sampleY = bounds.maxY - (row + 0.5) * cellHeight

    for (let column = 0; column < gridSize; column += 1) {
      const sampleX = bounds.minX + (column + 0.5) * cellWidth
      const inLeft = normalizedLeft.pads.some((pad) =>
        pointInPad(sampleX, sampleY, pad),
      )
      const inRight = normalizedRight.pads.some((pad) =>
        pointInPad(sampleX, sampleY, pad),
      )

      if (inLeft) leftCount += 1
      if (inRight) rightCount += 1
      if (inLeft && inRight) overlapCount += 1
    }
  }

  const unionCount = leftCount + rightCount - overlapCount
  const cellArea = cellWidth * cellHeight
  const intersectionArea = overlapCount * cellArea
  const unionArea = unionCount * cellArea

  return {
    copperIntersectionOverUnion:
      unionArea === 0 ? 0 : intersectionArea / unionArea,
  }
}
