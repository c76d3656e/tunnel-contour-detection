/** Uncompressed LAS 1.2 / 1.3 (and 1.4 point count) decoder. Runs in a worker. */

function readCString(bytes: Uint8Array): string {
  let end = bytes.length
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      end = i
      break
    }
  }
  return new TextDecoder('ascii').decode(bytes.subarray(0, end))
}

export function parseLas(buffer: ArrayBuffer, name: string): Float32Array {
  const lower = name.toLowerCase()
  if (lower.endsWith('.laz')) {
    throw new Error('请先解压成 .las。浏览器里暂不解码 LAZ。')
  }
  if (buffer.byteLength < 227) throw new Error('文件太小，不是有效的 LAS')
  const view = new DataView(buffer)
  const sig = readCString(new Uint8Array(buffer, 0, 4))
  if (sig !== 'LASF') throw new Error('文件头不是 LASF')

  const major = view.getUint8(24)
  const minor = view.getUint8(25)
  if (major !== 1) throw new Error(`不支持 LAS ${major}.${minor}`)

  const pointOffset = view.getUint32(96, true)
  const recordLen = view.getUint16(105, true)
  if (recordLen < 12) throw new Error('点记录长度异常')

  let count = view.getUint32(107, true)
  if (minor >= 4 && buffer.byteLength >= 255) {
    const big = view.getBigUint64(247, true)
    if (big > 0n) count = Number(big)
  }
  if (count <= 0) throw new Error('点云是空的')
  if (pointOffset + count * recordLen > buffer.byteLength) {
    throw new Error('点记录超出文件长度，可能是压缩 LAZ 或已损坏')
  }

  const sx = view.getFloat64(131, true)
  const sy = view.getFloat64(139, true)
  const sz = view.getFloat64(147, true)
  const ox = view.getFloat64(155, true)
  const oy = view.getFloat64(163, true)
  const oz = view.getFloat64(171, true)

  const xyz = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const at = pointOffset + i * recordLen
    xyz[i * 3] = view.getInt32(at, true) * sx + ox
    xyz[i * 3 + 1] = view.getInt32(at + 4, true) * sy + oy
    xyz[i * 3 + 2] = view.getInt32(at + 8, true) * sz + oz
  }
  return xyz
}
