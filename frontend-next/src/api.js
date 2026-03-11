export async function fetchSubscribe() {
  const base = import.meta.env.VITE_API_BASE || ''
  const resp = await fetch(`${base}/api/v1/user/getSubscribe`, {
    credentials: 'include'
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }

  const json = await resp.json()
  if (!json?.data) {
    throw new Error('Invalid subscribe payload')
  }
  return json.data
}
