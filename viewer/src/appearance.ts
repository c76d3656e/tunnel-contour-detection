export type ThemeId = 'dark' | 'light'

export interface Appearance {
  theme: ThemeId
  brightness: number
  cloud: string
  contour: string
  fit: string
  slice: string
  design: string
}

const STORAGE_KEY = 'tunnel-appearance-v1'

export const THEME_DEFAULTS: Record<ThemeId, Omit<Appearance, 'theme'>> = {
  dark: {
    brightness: 0.62,
    cloud: '#6a6762',
    contour: '#ff5a1f',
    fit: '#3ad0ff',
    slice: '#e8b04a',
    design: '#8dff6a',
  },
  light: {
    brightness: 0.55,
    cloud: '#5a564f',
    contour: '#c2410c',
    fit: '#1d4ed8',
    slice: '#b45309',
    design: '#15803d',
  },
}

export function defaultAppearance(theme: ThemeId = 'dark'): Appearance {
  return { theme, ...THEME_DEFAULTS[theme] }
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultAppearance()
    const parsed = JSON.parse(raw) as Partial<Appearance>
    const theme: ThemeId = parsed.theme === 'light' ? 'light' : 'dark'
    const base = defaultAppearance(theme)
    return {
      theme,
      brightness: clamp01(Number(parsed.brightness) || base.brightness, 0.28, 1),
      cloud: isHex(parsed.cloud) ? parsed.cloud : base.cloud,
      contour: isHex(parsed.contour) ? parsed.contour : base.contour,
      fit: isHex(parsed.fit) ? parsed.fit : base.fit,
      slice: isHex(parsed.slice) ? parsed.slice : base.slice,
      design: isHex(parsed.design) ? parsed.design : base.design,
    }
  } catch {
    return defaultAppearance()
  }
}

export function saveAppearance(look: Appearance): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(look))
}

export function applyThemeClass(theme: ThemeId): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', theme === 'light' ? '#e6dfd2' : '#14110e')
}

export function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16)
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = hexToInt(hex)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

export function scaledCloudRgb(look: Appearance): [number, number, number] {
  const [r, g, b] = hexToRgb(look.cloud)
  const gain = look.brightness
  return [r * gain, g * gain, b * gain]
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function clamp01(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
