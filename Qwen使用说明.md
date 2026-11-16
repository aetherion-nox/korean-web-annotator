# v1.1.2：Qwen 千问适配

基于上一版 v1.1.1，保留混种词对齐修复。

1. 解压后更新原插件目录，在扩展管理页重新加载插件，并刷新网页。
2. 打开 API 设置，服务商选择「Qwen 千问（阿里云百炼）」。
3. 选择账号已开通的模型，填写百炼 API Key。默认接口为北京地域；其他地域请填写百炼控制台给出的完整 Chat Completions 地址（结尾是 `/chat/completions`），并使用同地域的 Key。
4. 按需调整「关闭思考」；Qwen 3.8 支持 low、medium、xhigh。只支持思考的模型不会显示关闭开关。
5. 保存并点「测试 API」。需要模型参与消歧时，再打开插件的模型审核开关。

默认接口：
`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

支持控制台提供的业务空间专属地址，例如：
`https://你的业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`

接口依据 2026-10-27 查阅的阿里云官方文档适配。已完成模拟 HTTP、流式响应、候选验证和本地引擎回归测试；未使用真实 API Key 调用付费服务，也未验证你的账号开通了哪些模型。完整依据见 docs/qwen-api.md。

这是百炼 API 适配；千问聊天网站账号、第三方中转和本地部署的 Qwen 不一定使用相同参数。
