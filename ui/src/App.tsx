import { create } from 'zustand'

interface AppState {
  count: number
  increment: () => void
}

const useStore = create<AppState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}))

export default function App() {
  const { count, increment } = useStore()

  return (
    <div className="min-h-screen bg-brand-black text-brand-white p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4 tracking-heading font-display">Saboteur POS</h1>
      <p className="text-brand-mid mb-4">Zustand store active — count: {count}</p>
      <button
        onClick={increment}
        className="px-4 py-2 bg-brand-red hover:opacity-80 rounded-md text-sm tracking-label"
      >
        increment
      </button>
    </div>
  )
}
