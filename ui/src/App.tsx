import { create } from 'zustand'
import { Button } from '@/components/ui/button'

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
    <div className="min-h-screen bg-background text-foreground p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4 tracking-heading font-display">Saboteur POS</h1>
      <p className="text-muted-foreground mb-6">Zustand store active — count: {count}</p>
      <div className="flex gap-3">
        <Button onClick={increment}>increment</Button>
        <Button variant="outline" onClick={increment}>outline</Button>
        <Button variant="secondary" onClick={increment}>secondary</Button>
        <Button variant="ghost" onClick={increment}>ghost</Button>
      </div>
    </div>
  )
}
