import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * GeoBuilder batches many primitives into ONE BufferGeometry with per-vertex colours.
 * Every chunk of the city is built this way so the whole chunk costs only a handful
 * of draw calls, no matter how many props it contains.
 */
const tmpV = new THREE.Vector3()
const tmpN = new THREE.Vector3()
const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const tmpP = new THREE.Vector3()
const tmpE = new THREE.Euler()
const nMat = new THREE.Matrix3()
const tmpC = new THREE.Color()

const prim = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1),
  cone8: new THREE.ConeGeometry(0.5, 1, 8, 1),
  ico: new THREE.IcosahedronGeometry(0.5, 1),
  ico0: new THREE.IcosahedronGeometry(0.5, 0),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  card: new THREE.PlaneGeometry(1, 1),
  rbox: new RoundedBoxGeometry(1, 1, 1, 2, 0.16),
  /** car cabin: tapered greenhouse with raked windscreens and slight tumblehome */
  cabin: (() => {
    const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.1)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      if (y > 0) {
        const k = (y + 0.5) // 0.5..1
        p.setZ(i, p.getZ(i) * (1 - 0.34 * k) + (p.getZ(i) > 0 ? -0.06 : 0.02) * k)
        p.setX(i, p.getX(i) * (1 - 0.1 * k))
      }
    }
    g.computeVertexNormals()
    return g
  })(),
  cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1),
}
export type PrimName = keyof typeof prim

export class GeoBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  uv: number[] = []
  idx: number[] = []

  get vertexCount() {
    return this.pos.length / 3
  }

  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, uvScale?: [number, number]) {
    const p = g.attributes.position
    const n = g.attributes.normal
    const uvA = g.attributes.uv
    const base = this.vertexCount
    nMat.getNormalMatrix(m)
    tmpC.set(color)
    for (let i = 0; i < p.count; i++) {
      tmpV.fromBufferAttribute(p, i).applyMatrix4(m)
      this.pos.push(tmpV.x, tmpV.y, tmpV.z)
      if (n) {
        tmpN.fromBufferAttribute(n, i).applyMatrix3(nMat).normalize()
        this.nor.push(tmpN.x, tmpN.y, tmpN.z)
      } else this.nor.push(0, 1, 0)
      this.col.push(tmpC.r, tmpC.g, tmpC.b)
      if (uvA && uvScale) this.uv.push(uvA.getX(i) * uvScale[0], uvA.getY(i) * uvScale[1])
      else this.uv.push(0, 0)
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i))
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i)
  }

  /** Add a unit primitive scaled/rotated/translated. rot = [x,y,z] Euler radians. */
  prim(
    name: PrimName,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation,
    rotY = 0,
    rotX = 0,
    rotZ = 0,
  ) {
    tmpE.set(rotX, rotY, rotZ, 'YXZ')
    tmpQ.setFromEuler(tmpE)
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz))
    this.addGeometry(prim[name], tmpM, color)
  }

  /** Like prim() but keeps the primitive's UVs (for textured cards). */
  primUV(name: PrimName, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, rotY = 0, rotX = 0, rotZ = 0) {
    tmpE.set(rotX, rotY, rotZ, 'YXZ')
    tmpQ.setFromEuler(tmpE)
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz))
    this.addGeometry(prim[name], tmpM, color, [1, 1])
  }

  /** Box whose base sits at y (convenient for buildings/props). */
  boxBase(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rotY = 0) {
    this.prim('box', x, y + h / 2, z, w, h, d, color, rotY)
  }

  /** Box positioned in a parent's local frame (parent at px,pz with yaw prot). */
  boxLocal(
    px: number,
    pz: number,
    prot: number,
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    extraRot = 0,
  ) {
    const c = Math.cos(prot)
    const s = Math.sin(prot)
    this.prim('box', px + lx * c + lz * s, ly, pz - lx * s + lz * c, w, h, d, color, prot + extraRot)
  }

  primLocal(
    name: PrimName,
    px: number,
    pz: number,
    prot: number,
    lx: number,
    ly: number,
    lz: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation,
    rotX = 0,
    rotZ = 0,
  ) {
    const c = Math.cos(prot)
    const s = Math.sin(prot)
    this.prim(name, px + lx * c + lz * s, ly, pz - lx * s + lz * c, sx, sy, sz, color, prot, rotX, rotZ)
  }

  /** Raw quad (4 points, CCW seen from the normal side) with explicit UVs. */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    color: THREE.ColorRepresentation,
    uv: [number, number, number, number, number, number, number, number] = [0, 0, 1, 0, 1, 1, 0, 1],
  ) {
    const base = this.vertexCount
    const e1x = b[0] - a[0],
      e1y = b[1] - a[1],
      e1z = b[2] - a[2]
    const e2x = d[0] - a[0],
      e2y = d[1] - a[1],
      e2z = d[2] - a[2]
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l
    ny /= l
    nz /= l
    tmpC.set(color)
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2])
      this.nor.push(nx, ny, nz)
      this.col.push(tmpC.r, tmpC.g, tmpC.b)
    }
    this.uv.push(...uv)
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** Darken the last quad's bottom edge (a,b) for a baked ground-contact / AO gradient. */
  shadeLastQuadBottom(k: number) {
    const n = this.col.length
    for (const v of [n - 12, n - 9]) {
      this.col[v] *= k
      this.col[v + 1] *= k
      this.col[v + 2] *= k
    }
  }

  /** Horizontal quad on the ground from 4 XZ corners (CCW from above gives +Y normal). */
  groundQuad(pts: [number, number][], y: number, color: THREE.ColorRepresentation, uvScale = 0.125, down = false) {
    const [p0, p1, p2, p3] = pts
    // ensure upward (or downward) normal: compute signed area in XZ, flip if needed
    const area =
      (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])
    const up = area < 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1]
    const ordered = down ? [up[0], up[3], up[2], up[1]] : up
    const v = ordered.map((p) => [p[0], y, p[1]] as [number, number, number])
    const uv = ordered.flatMap((p) => [p[0] * uvScale, p[1] * uvScale]) as [
      number, number, number, number, number, number, number, number,
    ]
    this.quad(v[0], v[1], v[2], v[3], color, uv)
  }

  /** Flat triangles (e.g. a triangulated roof or lawn) at height y, facing up (or down). */
  flatTris(pts: [number, number][], tris: number[][], y: number, color: THREE.ColorRepresentation, uvScale = 0.125) {
    const base = this.vertexCount
    tmpC.set(color)
    for (const p of pts) {
      this.pos.push(p[0], y, p[1])
      this.nor.push(0, 1, 0)
      this.col.push(tmpC.r, tmpC.g, tmpC.b)
      this.uv.push(p[0] * uvScale, p[1] * uvScale)
    }
    for (const t of tris) {
      // ensure CCW seen from above (+Y normal): signed area in XZ must be negative
      const a = pts[t[0]],
        b = pts[t[1]],
        c = pts[t[2]]
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
      if (cross < 0) this.idx.push(base + t[0], base + t[1], base + t[2])
      else this.idx.push(base + t[0], base + t[2], base + t[1])
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    const vc = this.vertexCount
    g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}
