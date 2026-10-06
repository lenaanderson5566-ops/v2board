# 节点州、省与城市参考目录

核对日期：2026-10-06。共 127 个州、省或城市，其中美国 36 个。目录只维护地理名称、翻译、国家归属和位置类型，不保存或解析云厂商区域代码。

运营者先选国家，再选择州、省或城市，也可输入未收录的英文位置。国家、位置、线路后缀均可按需维护；只选国家时输出国家名称，不追加原节点名称。

以下公开文档仅用于核对地理位置，不参与运行时名称检索或节点匹配。参考目录不表示业务实际提供这些线路，也不是所有物理机房或可用区清单。

| 参考来源 | 官方文档 |
| --- | --- |
| AWS | [区域目录](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html) |
| Azure | [区域目录](https://learn.microsoft.com/en-us/azure/reliability/regions-list) |
| Google Cloud | [区域目录](https://docs.cloud.google.com/compute/docs/regions-zones) |
| Oracle Cloud | [区域目录](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm) |
| DigitalOcean | [区域目录](https://docs.digitalocean.com/platform/regional-availability/) |
| Hetzner | [区域目录](https://docs.hetzner.com/cloud/general/locations/) |
| Vultr | [区域目录](https://api.vultr.com/v2/regions) |
| Akamai / Linode | [区域目录](https://api.linode.com/v4/regions) |
| OVHcloud | [区域目录](https://www.ovhcloud.com/en/about-us/global-infrastructure/expansion-regions-az/) |
| Alibaba Cloud | [区域目录](https://www.alibabacloud.com/help/en/ecs/user-guide/regions-and-zones) |


维护翻译时保留已发布的地理标识。新增位置需提供中文、英文、国家代码以及 state / city 类型，所有协议共用 resources/client/node-locations.json。列表展示州、省或城市名称，不展示内部标识。

新增位置至少提供简体中文与英文；繁体中文同步维护。其他支持语言缺少翻译时回退英文。App 与开源订阅通过现有 displayNames / 名称生成逻辑展示；位置标识不参与节点连接身份匹配。
