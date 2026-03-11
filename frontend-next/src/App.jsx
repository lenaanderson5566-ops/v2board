import { Alert, Button, Layout, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import QuotaDashboardCard from './components/QuotaDashboardCard'
import { fetchSubscribe } from './api'

const { Header, Content } = Layout
const { Title, Text } = Typography

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
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title level={4} style={{ color: '#fff', margin: 0 }}>V2Board Frontend Next</Title>
        <Button onClick={load}>刷新</Button>
      </Header>
      <Content style={{ maxWidth: 960, margin: '24px auto', width: '100%', padding: '0 16px' }}>
        <Alert type="info" showIcon message="这是基于编译产物重建的现代源码骨架（Vite + React + Ant Design）。" style={{ marginBottom: 16 }} />
        {loading && <Spin />}
        {!loading && error && <Alert type="error" showIcon message={error} />}
        {!loading && !error && data && <QuotaDashboardCard data={data} />}
        <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
          默认读取 /api/v1/user/getSubscribe，可通过 VITE_API_BASE 配置后端前缀。
        </Text>
      </Content>
    </Layout>
  )
}
