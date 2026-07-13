import { create } from 'zustand'

const DEFAULT_SIZE = 14
const MIN_SIZE = 10
const MAX_SIZE = 22

const getSavedSize = (): number => {
  try {
    const saved = localStorage.getItem('ccnexus-font-size')
    return saved ? parseInt(saved) : DEFAULT_SIZE
  } catch {
    return DEFAULT_SIZE
  }
}

interface UIState {
  fontSize: number
  increaseFont: () => void
  decreaseFont: () => void
  resetFont: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  fontSize: getSavedSize(),

  increaseFont: () => set((s) => {
    const next = Math.min(s.fontSize + 1, MAX_SIZE)
    localStorage.setItem('ccnexus-font-size', String(next))
    return { fontSize: next }
  }),

  decreaseFont: () => set((s) => {
    const next = Math.max(s.fontSize - 1, MIN_SIZE)
    localStorage.setItem('ccnexus-font-size', String(next))
    return { fontSize: next }
  }),

  resetFont: () => {
    localStorage.setItem('ccnexus-font-size', String(DEFAULT_SIZE))
    set({ fontSize: DEFAULT_SIZE })
  }
}))
