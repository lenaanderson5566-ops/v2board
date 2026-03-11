function toBytesText(bytes) {
  const num = Number(bytes || 0)
  if (!Number.isFinite(num) || num <= 0) return '0.00 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = num
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(2)} ${units[idx]}`
}

function pct(used, total) {
  const u = Number(used || 0)
  const t = Number(total || 0)
  if (t <= 0) return 0
  return Math.max(0, Math.min(100, Number(((u / t) * 100).toFixed(2))))
}

function dateText(unixTs) {
  const ts = Number(unixTs || 0)
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return '-'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

function Section({ title, used, total, remaining, color }) {
  const p = pct(used, total)
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>{title}</strong>
        <span>{toBytesText(used)} / {toBytesText(total)} ({p}%)</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: '#edf2f7', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${p}%`, height: '100%', background: color }} />
      </div>
      <div style={{ color: '#6b7280' }}>剩余：{toBytesText(remaining)}</div>
    </div>
  )
}

export default function QuotaDashboardCard({ data }) {
  const totalUsed = Number(data.total_used_bytes || (Number(data.u || 0) + Number(data.d || 0)) || 0)
  const totalQuota = Number(data.transfer_enable || 0)
  const totalRemain = Number(data.total_remaining_bytes || Math.max(totalQuota - totalUsed, 0))

  const subTotal = Number(data.subscription_quota_total_bytes || 0)
  const subUsed = Number(data.subscription_quota_used_bytes || 0)
  const subRemain = Number(data.subscription_quota_remaining_bytes || Math.max(subTotal - subUsed, 0))

  const pkgTotal = Number(data.quota_package_total_bytes || 0)
  const pkgUsed = Number(data.quota_package_used_bytes || 0)
  const pkgRemain = Number(data.quota_package_remaining_bytes || Math.max(pkgTotal - pkgUsed, 0))

  const expiredAt = dateText(data.expired_at)
  const resetIn = data.reset_day === null || data.reset_day === undefined ? '-' : `${data.reset_day} 天后`

  return (
    <div style={{ border: '1px solid #dbe1ea', borderRadius: 12, background: '#fff', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>流量看板（新版源码）</h3>
        <span style={{ fontSize: 12, border: '1px solid #d1fae5', color: pkgTotal > 0 ? '#065f46' : '#6b7280', background: pkgTotal > 0 ? '#ecfdf5' : '#f3f4f6', padding: '2px 8px', borderRadius: 999 }}>
          {pkgTotal > 0 ? '已购买流量包' : '未购买流量包'}
        </span>
      </div>

      <div style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fafafa' }}>
        <div>到期时间：{expiredAt}</div>
        <div>重置时间：{resetIn}</div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <Section title="总流量（套餐 + 流量包）" used={totalUsed} total={totalQuota} remaining={totalRemain} color="#1677ff" />
        <Section title="套餐月流量" used={subUsed} total={subTotal} remaining={subRemain} color="#722ed1" />
        <Section title="流量额度包" used={pkgUsed} total={pkgTotal} remaining={pkgRemain} color="#faad14" />
      </div>
    </div>
  )
}
