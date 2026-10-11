import { type Footprint, footprinterStringToFootprint } from "./footprint.js"
import {
  getShapeListBounds,
  getTransformedPcbPadGeometry,
  type PcbPadGeometry,
} from "./footprint-geometry.js"

const ROW_ALPHABET = "ABCDEFGHJKLMNPRTUVWY"
const TOLERANCE = 0.00001
const length = (value: number) => `${Number(value.toFixed(6))}mm`
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE

interface Site {
  id: string
  row: number
  signX: number
  signY: number
  pitchX: number
  pitchY: number
  vertical: boolean
}

const rowLabel = (index: number) => {
  let result = ""
  for (
    let value = index + 1;
    value > 0;
    value = Math.floor((value - 1) / ROW_ALPHABET.length)
  )
    result = ROW_ALPHABET[(value - 1) % ROW_ALPHABET.length] + result
  return result
}

const rowIndex = (label: string) => {
  let result = 0
  for (const character of label) {
    const digit = ROW_ALPHABET.indexOf(character)
    if (digit < 0) return undefined
    result = result * ROW_ALPHABET.length + digit + 1
    if (!Number.isSafeInteger(result)) return undefined
  }
  return result - 1
}

const physicalId = (pad: PcbPadGeometry) => {
  for (const hint of pad.element.port_hints ?? []) {
    const numeric = hint.match(/^(?:pin)?([1-9]\d*)$/i)
    if (numeric) return numeric[1]
    if (/^[A-Z]+[1-9]\d*$/.test(hint)) return hint
  }
  return undefined
}

// These are the nominal QFN perimeter equations, rather than a chip-specific
// coordinate table. Missing contacts do not change the position or ID of a site.
const nominalSites = (
  columns: number,
  rows: number,
  rowCount: 1 | 2,
  staggered: boolean,
  ballCoordinates: boolean,
): Site[] => {
  const sites: Site[] = []
  for (let row = 0; row < rowCount; row++) {
    const nx = columns - 2 * row
    const ny = rows - 2 * row
    const column = (i: number) =>
      row
        ? 4 + 2 * i - Number(staggered)
        : i === columns - 1
          ? 2 * columns - 1
          : 2 + 2 * i
    const labelRow = (i: number) =>
      row ? 2 + 2 * i + Number(staggered) : i === 0 ? 1 : 2 * i
    const add = (
      signX: number,
      signY: number,
      pitchX: number,
      pitchY: number,
      r: number,
      c: number,
      vertical: boolean,
    ) => {
      sites.push({
        id: ballCoordinates ? `${rowLabel(r)}${c}` : String(sites.length + 1),
        row,
        signX,
        signY,
        pitchX,
        pitchY,
        vertical,
      })
    }
    const offset = row && staggered ? -0.5 : 0
    for (let i = 0; i < ny; i++)
      add(-1, 0, 0, (ny - 1) / 2 - i + offset, labelRow(i), row + 1, true)
    for (let i = 0; i < nx; i++)
      add(
        0,
        -1,
        i - (nx - 1) / 2 + offset,
        0,
        2 * rows - 1 - row,
        column(i),
        false,
      )
    for (let i = ny - 1; i >= 0; i--)
      add(
        1,
        0,
        0,
        (ny - 1) / 2 - i + offset,
        labelRow(i),
        2 * columns - row,
        true,
      )
    for (let i = nx - 1; i >= 0; i--)
      add(0, 1, i - (nx - 1) / 2 + offset, 0, row, column(i), false)
  }
  return sites
}

// Fit package translation, opposing half-spans, the common row gap and the
// independent pitches. Reject underdetermined fits instead of guessing geometry.
const solve = (equations: { coefficients: number[]; value: number }[]) => {
  const n = equations[0].coefficients.length
  const matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      equations.reduce(
        (sum, equation) =>
          sum +
          equation.coefficients[i] *
            (j === n ? equation.value : equation.coefficients[j]),
        0,
      ),
    ),
  )
  for (let column = 0; column < n; column++) {
    let pivot = column
    for (let row = column + 1; row < n; row++)
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column]))
        pivot = row
    if (Math.abs(matrix[pivot][column]) < 1e-10) return undefined
    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
    const divisor = matrix[column][column]
    for (let j = column; j <= n; j++) matrix[column][j] /= divisor
    for (let row = 0; row < n; row++) {
      if (row === column) continue
      const factor = matrix[row][column]
      for (let j = column; j <= n; j++)
        matrix[row][j] -= factor * matrix[column][j]
    }
  }
  const values = matrix.map((row) => row[n])
  return equations.every(({ coefficients, value }) =>
    close(
      coefficients.reduce(
        (sum, coefficient, i) => sum + coefficient * values[i],
        0,
      ),
      value,
    ),
  )
    ? values
    : undefined
}

const getEquations = (site: Site, pad: PcbPadGeometry, twoRows: boolean) => [
  {
    coefficients: [
      1,
      0,
      site.signX,
      0,
      ...(twoRows ? [-site.signX * site.row] : []),
      site.pitchX,
      0,
    ],
    value: pad.copper.x,
  },
  {
    coefficients: [
      0,
      1,
      0,
      site.signY,
      ...(twoRows ? [-site.signY * site.row] : []),
      0,
      site.pitchY,
    ],
    value: pad.copper.y,
  },
]

const matchesBuiltPads = (
  recipe: string,
  target: PcbPadGeometry[],
  centerX: number,
  centerY: number,
) => {
  let built: Footprint
  try {
    built = footprinterStringToFootprint(recipe)
  } catch {
    return false
  }
  const generated = built.pads.map((pad) =>
    getTransformedPcbPadGeometry(pad, built),
  )
  if (generated.length !== target.length) return false
  return target.every((pad) => {
    const id = physicalId(pad)
    const exposed = pad.element.port_hints?.some(
      (hint) => hint === "EP" || hint === "thermalpad",
    )
    const other = generated.find((candidate) =>
      exposed
        ? candidate.element.port_hints?.includes("thermalpad")
        : physicalId(candidate) === id,
    )
    return (
      other &&
      other.copper.shape === pad.copper.shape &&
      close(other.copper.x + centerX, pad.copper.x) &&
      close(other.copper.y + centerY, pad.copper.y) &&
      close(other.copper.width, pad.copper.width) &&
      close(other.copper.height, pad.copper.height) &&
      close(other.copper.cornerRadius ?? 0, pad.copper.cornerRadius ?? 0) &&
      close((other.copper.rotation - pad.copper.rotation) % 180, 0) &&
      !pad.drill
    )
  })
}

const getCanonicalQfnGridSeeds = (target: Footprint): string[] => {
  if (target.holes.length || target.vias.length || target.pads.length < 8)
    return []
  const pads = target.pads.map((pad) => {
    const geometry = getTransformedPcbPadGeometry(pad, target)
    const angle = ((geometry.copper.rotation % 180) + 180) % 180
    if (geometry.copper.shape === "circle") geometry.copper.rotation = 0
    else if (close(angle, 90)) {
      const { width, height } = geometry.copper
      geometry.copper = {
        ...geometry.copper,
        width: height,
        height: width,
        rotation: 0,
      }
    } else if (close(angle, 0)) geometry.copper.rotation = 0
    return geometry
  })
  if (
    pads.some(
      ({ element, copper }) =>
        element.type !== "pcb_smtpad" ||
        !["circle", "rect", "pill"].includes(copper.shape),
    )
  )
    return []
  const exposed = pads.filter((pad) =>
    pad.element.port_hints?.some(
      (hint) => hint === "EP" || hint === "thermalpad",
    ),
  )
  if (exposed.length > 1 || exposed.some((pad) => pad.copper.shape !== "rect"))
    return []
  const contacts = pads.filter((pad) => !exposed.includes(pad))
  // A two-row perimeter is covered by four fixed x rails and four fixed y
  // rails. This necessary bound cheaply rejects large filled BGA grids before
  // enumerating any nominal pin layouts.
  const largestRailCounts = (axis: "x" | "y") => {
    const coordinates = contacts
      .map((pad) => pad.copper[axis])
      .toSorted((a, b) => a - b)
    const counts: number[] = []
    let previous = -Infinity
    for (const coordinate of coordinates) {
      if (!close(previous, coordinate)) counts.push(0)
      counts[counts.length - 1]++
      previous = coordinate
    }
    return counts
      .toSorted((a, b) => b - a)
      .slice(0, 4)
      .reduce((sum, count) => sum + count, 0)
  }
  if (largestRailCounts("x") + largestRailCounts("y") < contacts.length)
    return []
  const ids = contacts.map(physicalId)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return []
  const ballCoordinates = ids.every((id) => /^[A-Z]+\d+$/.test(id!))
  if (!ballCoordinates && ids.some((id) => !/^\d+$/.test(id!))) return []
  const byId = new Map(contacts.map((pad) => [physicalId(pad)!, pad]))
  const circular = contacts.every((pad) => pad.copper.shape === "circle")
  const pill = contacts.every((pad) => pad.copper.shape === "pill")
  if (!circular && !pill && contacts.some((pad) => pad.copper.shape !== "rect"))
    return []
  const hypotheses: { columns: number; rows: number; rowCount: 1 | 2 }[] = []
  // Geometry with more missing sites than observed contacts is too ambiguous
  // for this recognizer. Also bounds work for malformed gigantic physical IDs.
  const maximumNominalCount = 2 * contacts.length + 8
  if (ballCoordinates) {
    const coordinates = ids.map((id) => id!.match(/^([A-Z]+)(\d+)$/)!)
    const rowIndices = coordinates.map((coordinate) => rowIndex(coordinate[1]))
    if (rowIndices.some((index) => index === undefined)) return []
    const columns = Math.ceil(
      Math.max(...coordinates.map((coordinate) => Number(coordinate[2]))) / 2,
    )
    const rows = Math.ceil((Math.max(...(rowIndices as number[])) + 1) / 2)
    if (
      !Number.isSafeInteger(columns) ||
      4 * (columns + rows) - 8 > maximumNominalCount
    )
      return []
    for (let x = columns; x <= columns + 1; x++)
      for (let y = rows; y <= rows + 1; y++)
        if (x >= 3 && y >= 3 && 4 * (x + y) - 8 <= maximumNominalCount)
          hypotheses.push({ columns: x, rows: y, rowCount: 2 })
  } else {
    const maximumId = Math.max(...ids.map(Number))
    if (!Number.isSafeInteger(maximumId) || maximumId > maximumNominalCount)
      return []
    // Include tail omissions while requiring enough surviving contacts to infer
    // the nominal lattice. The fit below must have full rank on both axes.
    for (
      let nominalCount = maximumId;
      nominalCount <= maximumNominalCount;
      nominalCount++
    ) {
      for (const rowCount of [1, 2] as const) {
        const sum = rowCount === 1 ? nominalCount / 2 : (nominalCount + 8) / 4
        if (!Number.isInteger(sum)) continue
        const minimum = rowCount === 1 ? 1 : 3
        for (let columns = minimum; columns <= sum - minimum; columns++)
          hypotheses.push({ columns, rows: sum - columns, rowCount })
      }
    }
  }
  const results: string[] = []
  for (const { columns, rows, rowCount } of hypotheses) {
    for (const staggered of rowCount === 2 ? [false, true] : [false]) {
      const sites = nominalSites(
        columns,
        rows,
        rowCount,
        staggered,
        ballCoordinates,
      )
      const present = sites.filter((site) => byId.has(site.id))
      if (present.length !== contacts.length) continue
      const fitted = solve(
        present.flatMap((site) =>
          getEquations(site, byId.get(site.id)!, rowCount === 2),
        ),
      )
      if (!fitted) continue
      const [centerX, centerY, halfX, halfY] = fitted
      const gap = rowCount === 2 ? fitted[4] : 0
      const pitchX = fitted.at(-2)!
      const pitchY = fitted.at(-1)!
      if (
        [halfX, halfY, pitchX, pitchY].some((value) => value <= 0) ||
        (rowCount === 2 && gap <= 0)
      )
        continue
      const first = present[0]
      const shape = byId.get(first.id)!.copper
      const padWidth = circular
        ? shape.width
        : first.vertical
          ? shape.height
          : shape.width
      const padLength = circular
        ? shape.height
        : first.vertical
          ? shape.width
          : shape.height
      if (
        present.some((site) => {
          const { copper } = byId.get(site.id)!
          return (
            !close(
              copper.width,
              circular || !site.vertical ? padWidth : padLength,
            ) ||
            !close(
              copper.height,
              circular || site.vertical ? padWidth : padLength,
            ) ||
            (!circular && !close(copper.rotation % 180, 0))
          )
        })
      )
        continue
      const bounds = getShapeListBounds(pads.map((pad) => pad.copper))
      // A common opposing span can be represented explicitly; rectangular
      // packages use the standard w/h minus pad-length/edge-margin convention.
      const explicitSpan = rowCount === 2 && close(halfX, halfY)
      const width = explicitSpan
        ? bounds.width + 0.2
        : 2 * halfX + padLength + 0.2
      const height = explicitSpan
        ? bounds.height + 0.2
        : 2 * halfY + padLength + 0.2
      const tokens = [
        `qfn${sites.length}`,
        `grid${columns}x${rows}`,
        ...(rowCount === 2
          ? [
              "rows2",
              ...(staggered ? ["staggered"] : []),
              ...(explicitSpan ? [`rowspan${length(2 * halfX)}`] : []),
              `rowgap${length(gap)}`,
            ]
          : []),
        `px${length(pitchX)}`,
        `py${length(pitchY)}`,
        `pw${length(padWidth)}`,
        `pl${length(padLength)}`,
        ...(circular ? ["circularpads"] : pill ? ["pillpads"] : []),
        `w${length(width)}`,
        `h${length(height)}`,
        ...(ballCoordinates ? ["pinnumbering(ballcoords)"] : []),
      ]
      if (exposed.length) {
        const { copper } = exposed[0]
        tokens.push(
          `thermalpad${length(copper.width).replace(/mm$/, "")}x${length(copper.height)}`,
        )
        if (!close(copper.x, centerX))
          tokens.push(`thermalpadcenteroffsetx${length(copper.x - centerX)}`)
        if (!close(copper.y, centerY))
          tokens.push(`thermalpadcenteroffsety${length(copper.y - centerY)}`)
      }
      const missing = sites
        .filter((site) => !byId.has(site.id))
        .map((site) => site.id)
      // Existing ordinary full-perimeter discovery remains responsible for
      // choosing among geometrically equivalent QFN/LGA/quad families.
      if (rowCount === 1 && missing.length === 0) continue
      if (missing.length) tokens.push(`missing(${missing.join(",")})`)
      const recipe = tokens.join("_")
      if (matchesBuiltPads(recipe, pads, centerX, centerY)) results.push(recipe)
      else {
        const radius = Math.max(
          ...pads.map((pad) => pad.copper.cornerRadius ?? 0),
        )
        if (radius > 0) {
          const roundedRecipe = `${recipe}_rounded${length(radius)}`
          if (matchesBuiltPads(roundedRecipe, pads, centerX, centerY))
            results.push(roundedRecipe)
        }
      }
    }
  }
  return [...new Set(results)]
}

/** Discover fully measured QFN recipes with retained physical contact IDs. */
export const getQfnGridSeeds = (target: Footprint): string[] => [
  ...new Set(
    [0, 90, 180, 270].flatMap((rotation) =>
      getCanonicalQfnGridSeeds({
        ...target,
        rotation: (target.rotation ?? 0) + rotation,
      }),
    ),
  ),
]
