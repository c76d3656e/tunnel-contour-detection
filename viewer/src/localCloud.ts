import type { ExportKind, ExportResult, Health, Meta, SliceParams } from './types'
import type { HorseshoeParams } from './horseshoe'
import { transferList, type PackedExport } from './exportPack'

interface WorkerReady {
  type: 'ready'
  meta: Meta
  viz: Float32Array
}

interface WorkerProgress {
  type: 'progress'
  message: string
  source_name?: string | null
}

interface WorkerPacked {
  type: 'packed'
  pack: PackedExport
}

interface WorkerPlotted {
  type: 'plotted'
  stamp: string
  blobs: Partial<Record<ExportKind, Blob>>
}

interface WorkerError {
  type: 'error'
  message: string
}

type CloudOut = WorkerReady | WorkerProgress | WorkerPacked | WorkerError
type PlotOut = WorkerPlotted | WorkerProgress | WorkerError | { type: 'ready' }

export class LocalCloud {
  private worker: Worker | null = null
  private plotWorker: Worker | null = null
  private pendingCloud: {
    resolve: (value: WorkerReady | WorkerPacked) => void
    reject: (error: Error) => void
  } | null = null
  private pendingPlot: {
    resolve: (value: WorkerPlotted) => void
    reject: (error: Error) => void
  } | null = null
  private onProgress: ((health: Health) => void) | null = null
  private plotProgress: ((message: string) => void) | null = null

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./cloudWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<CloudOut>) => {
      const data = event.data
      if (data.type === 'progress') {
        this.onProgress?.({ status: 'loading', message: data.message, source_name: data.source_name })
        return
      }
      if (data.type === 'error') {
        this.pendingCloud?.reject(new Error(data.message))
        this.pendingCloud = null
        return
      }
      if (data.type === 'ready' || data.type === 'packed') {
        this.pendingCloud?.resolve(data)
        this.pendingCloud = null
      }
    }
    worker.onerror = (event) => {
      this.pendingCloud?.reject(new Error(event.message || '本机点云线程失败'))
      this.pendingCloud = null
    }
    this.worker = worker
    return worker
  }

  private ensurePlotWorker(): Worker {
    if (this.plotWorker) return this.plotWorker
    const worker = new Worker(new URL('./plotWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<PlotOut>) => {
      const data = event.data
      if (data.type === 'progress') {
        this.plotProgress?.(data.message)
        return
      }
      if (data.type === 'ready') return
      if (data.type === 'error') {
        this.pendingPlot?.reject(new Error(data.message))
        this.pendingPlot = null
        return
      }
      this.pendingPlot?.resolve(data)
      this.pendingPlot = null
    }
    worker.onerror = (event) => {
      this.pendingPlot?.reject(new Error(event.message || 'matplotlib 线程失败'))
      this.pendingPlot = null
    }
    this.plotWorker = worker
    worker.postMessage({ type: 'init' })
    return worker
  }

  async open(file: File, onProgress: (health: Health) => void): Promise<{ meta: Meta; viz: Float32Array }> {
    this.onProgress = onProgress
    onProgress({ status: 'loading', message: `正在读入 ${file.name}`, source_name: file.name })
    const buffer = await file.arrayBuffer()
    const worker = this.ensureWorker()
    this.ensurePlotWorker()
    const result = await new Promise<WorkerReady | WorkerPacked>((resolve, reject) => {
      this.pendingCloud = { resolve, reject }
      worker.postMessage({ type: 'open', name: file.name, buffer }, [buffer])
    })
    if (result.type !== 'ready') throw new Error('打开点云失败')
    return { meta: result.meta, viz: result.viz }
  }

  async export(
    params: SliceParams,
    kinds: ExportKind[],
    horseshoe: HorseshoeParams,
    onProgress?: (message: string) => void,
  ): Promise<ExportResult> {
    this.plotProgress = onProgress ?? null
    try {
      const worker = this.ensureWorker()
      const packed = await new Promise<WorkerReady | WorkerPacked>((resolve, reject) => {
        this.pendingCloud = { resolve, reject }
        worker.postMessage({ type: 'export', params, kinds, horseshoe })
      })
      if (packed.type !== 'packed') throw new Error('切片数据准备失败')
      this.plotProgress?.('正在用 matplotlib 出图')
      const plotter = this.ensurePlotWorker()
      const plotted = await new Promise<WorkerPlotted>((resolve, reject) => {
        this.pendingPlot = { resolve, reject }
        plotter.postMessage({ type: 'plot', pack: packed.pack }, { transfer: transferList(packed.pack) })
      })
      const urls: Partial<Record<ExportKind, string>> = {}
      for (const [key, blob] of Object.entries(plotted.blobs) as [ExportKind, Blob | undefined][]) {
        if (blob) urls[key] = URL.createObjectURL(blob)
      }
      return { stamp: plotted.stamp, urls }
    } finally {
      this.plotProgress = null
    }
  }

  dispose(): void {
    this.worker?.terminate()
    this.plotWorker?.terminate()
    this.worker = null
    this.plotWorker = null
    this.pendingCloud = null
    this.pendingPlot = null
  }
}
