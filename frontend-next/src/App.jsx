import { useEffect, useState } from 'react'
import QuotaDashboardCard from './components/QuotaDashboardCard'
import { fetchSubscribe } from './api'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const subscribe = await fetchSubscribe()
      setData(subscribe)
    } catch (e) {
      setError(e.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb', color: '#1f2937' }}>
      <header style={{ height: 64, background: '#0b2239', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <h2 style={{ margin: 0, fontSize: 30 }}>V2Board Frontend Next</h2>
        <button onClick={load} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>刷新</button>
      </header>

      <main style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #cfe3ff', background: '#ecf5ff', borderRadius: 8 }}>
          这是基于编译产物重建的现代源码骨架（Vite + React，无 Ant Design）。
        </div>

        {loading && <div>加载中...</div>}
        {!loading && error && (
          <div style={{ marginBottom: 12, padding: 12, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 8, color: '#991b1b' }}>
            {error}
          </div>
        )}

        {!loading && !error && data && <QuotaDashboardCard data={data} />}

        <div style={{ marginTop: 16, color: '#6b7280', fontSize: 14 }}>
          默认读取 /api/v1/user/getSubscribe，可通过 VITE_API_BASE 配置后端前缀。
        </div>
      </main>
    </div>
  )
}
