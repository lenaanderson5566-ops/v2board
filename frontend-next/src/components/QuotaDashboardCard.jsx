import { Card, Col, Progress, Row, Tag, Typography } from 'antd'
import dayjs from 'dayjs'

const { Text } = Typography

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

  const expiredAt = data.expired_at ? dayjs.unix(Number(data.expired_at)).format('YYYY/MM/DD') : '-'
  const resetIn = data.reset_day === null || data.reset_day === undefined ? '-' : `${data.reset_day} 天后`

  return (
    <Card title="流量看板（新版源码）" extra={<Tag color={pkgTotal > 0 ? 'green' : 'default'}>{pkgTotal > 0 ? '已购买流量包' : '未购买流量包'}</Tag>}>
      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Card size="small" title="订阅信息">
            <Text>到期时间：{expiredAt}</Text>
            <br />
            <Text>重置时间：{resetIn}</Text>
          </Card>
        </Col>

        <Col span={24}>
          <Card size="small" title="总流量（套餐 + 流量包）">
            <Text>{toBytesText(totalUsed)} / {toBytesText(totalQuota)}</Text>
            <Progress percent={pct(totalUsed, totalQuota)} strokeColor="#1677ff" />
            <Text type="secondary">剩余：{toBytesText(totalRemain)}</Text>
          </Card>
        </Col>

        <Col span={24}>
          <Card size="small" title="套餐月流量">
            <Text>{toBytesText(subUsed)} / {toBytesText(subTotal)}</Text>
            <Progress percent={pct(subUsed, subTotal)} strokeColor="#722ed1" />
            <Text type="secondary">剩余：{toBytesText(subRemain)}</Text>
          </Card>
        </Col>

        <Col span={24}>
          <Card size="small" title="流量额度包">
            <Text>{toBytesText(pkgUsed)} / {toBytesText(pkgTotal)}</Text>
            <Progress percent={pct(pkgUsed, pkgTotal)} strokeColor="#faad14" />
            <Text type="secondary">剩余：{toBytesText(pkgRemain)}</Text>
          </Card>
        </Col>
      </Row>
    </Card>
  )
}
