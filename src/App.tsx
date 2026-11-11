// App — hash-based routing (no router dependency) + a thin top bar.

import { useEffect, useState } from 'react'
import { Home } from './pages/Home'
import { LabPage } from './pages/LabPage'
import { Sandbox } from './pages/Sandbox'

function useHashRoute() {
  const [hash, setHash] = useState(
    () => window.location.hash || '#/',
  )
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = (h: string) => {
    window.location.hash = h
  }
  return { hash, navigate }
}

function App() {
  const { hash, navigate } = useHashRoute()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const labMatch = hash.match(/^#\/lab\/(\w+)/)

  let page
  if (labMatch) page = <LabPage id={labMatch[1]} navigate={navigate} />
  else if (hash.startsWith('#/sandbox')) page = <Sandbox navigate={navigate} />
  else page = <Home navigate={navigate} />

  return (
    <div className="min-h-full">
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 border-b"
        style={{
          background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <button
          className="font-bold tracking-tight"
          style={{ color: 'var(--text-hi)' }}
          onClick={() => navigate('#/')}
        >
          <span style={{ color: 'var(--accent)' }}>///</span> CPU&nbsp;Labs
        </button>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => navigate('#/sandbox')}>
            Sandbox
          </button>
          <button
            className="btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-4 py-6">{page}</main>
    </div>
  )
}

export default App
