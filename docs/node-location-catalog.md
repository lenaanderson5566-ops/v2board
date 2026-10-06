# 节点州、省与城市参考目录

核对日期：2026-10-06。共 127 个去重位置、288 个厂商区域代码。

这是节点编辑参考目录，不是所有物理机房、可用区或边缘节点清单。主要公开商业机房位置纳入；AWS 政府云、中国独立账户区域、Azure 主权云、Linode 分布式站点及各厂商全部 Local Zones 不在本次范围。Alibaba Cloud 主要维护国际区域及香港。厂商只公布国家、无法确认单一州或城市的位置暂不映射，运营者可手动填写。参考列表不表示本业务实际提供这些线路。

| 厂商 | 可映射区域代码数 | 官方来源 |
| --- | ---: | --- |
| AWS | 29 | [区域目录](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html) |
| Azure | 52 | [区域目录](https://learn.microsoft.com/en-us/azure/reliability/regions-list) |
| Google Cloud | 43 | [区域目录](https://docs.cloud.google.com/compute/docs/regions-zones) |
| Oracle Cloud | 44 | [区域目录](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm) |
| DigitalOcean | 16 | [区域目录](https://docs.digitalocean.com/platform/regional-availability/) |
| Hetzner | 6 | [区域目录](https://docs.hetzner.com/cloud/general/locations/) |
| Vultr | 33 | [区域目录](https://api.vultr.com/v2/regions) |
| Akamai / Linode | 33 | [区域目录](https://api.linode.com/v4/regions) |
| OVHcloud | 15 | [区域目录](https://www.ovhcloud.com/en/about-us/global-infrastructure/expansion-regions-az/) |
| Alibaba Cloud | 17 | [区域目录](https://www.alibabacloud.com/help/en/ecs/user-guide/regions-and-zones) |

AWS 的加拿大中部采用官方公开的蒙特利尔位置、西班牙采用阿拉贡、新西兰采用奥克兰、爱尔兰采用都柏林；补充来源：

- [AWS 官方补充说明](https://aws.amazon.com/blogs/publicsector/coming-soon-aws-launching-new-region-spain-2022/)
- [AWS 官方补充说明](https://aws.amazon.com/blogs/aws/now-open-third-availability-zone-in-the-aws-canada-central-region/)
- [AWS 官方补充说明](https://aws.amazon.com/local/new-zealand/)
- [AWS 官方补充说明](https://d0.awsstatic.com/whitepapers/compliance/AWS_EU_Data_Protection_Whitepaper_011215.pdf)

位置只使用州、省或城市：北加利福尼亚归入加利福尼亚州，北弗吉尼亚归入弗吉尼亚州。Google Cloud `asia-east1` 为彰化县，OVHcloud 德国位置为林堡；不按城市知名度擅自改成台北或法兰克福。Azure Japan East 公开为东京、埼玉，未将区域代码强行归入其中一个城市。

维护翻译时保留已发布的统一标识；新增云区域应同时记录来源及核对日期。参考代码保存在厂商命名空间，同名代码不自动假定相同位置。只有归一后确属相同州、省或城市的参考项共用一个标识。云厂商信息不输出到节点名称，也不作为认证或连接配置下发。

新增位置至少提供简体中文与英文；繁体中文同步生成。其他当前支持的语言缺少翻译时回退英文，可补充原生译名。App 与开源订阅通过现有 displayNames / 名称生成逻辑展示；位置标识不参与节点连接身份匹配。
