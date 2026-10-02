# Azure 套餐自动翻译

在服务器 .env 设置 AZURE_TRANSLATOR_KEY、AZURE_TRANSLATOR_REGION，默认端点 https://api.cognitive.microsofttranslator.com。自定义 Azure 资源端点应包含 /translator/text/v3.0（不包含 /translate）。运行 php artisan config:cache。

后台「套餐多语言」选择现有套餐，确认原文语言，点击「生成缺失译文」。确认后仅将当前套餐的描述发送给 Azure；不发送用户信息或价格字段。八种语言逐一生成，已有译文跳过；品牌套餐名称保持原样。JSON 只翻译 feature，support 和其他字段保持不变；HTML 使用 Azure HTML 模式。数字变化时拒绝译文。空描述不会调用外部服务。

展开语言预览并编辑后点击保存。保存前校验原文未变化，避免覆盖已存在的说明。部分生成或保存失败可保留已完成结果、修正配置后重试。按套餐逐一处理，避免一次请求大量套餐导致超时或费用失控。

沿用 v2_plan_translation 表，无新增迁移。缺失译文仍回退默认描述。密钥只在服务端使用，不进入前端构建。后台无凭据时会提示配置，部署不会自动翻译或计费。
