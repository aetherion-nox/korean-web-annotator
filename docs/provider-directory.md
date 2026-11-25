# API 渠道和模型目录

打开扩展的 API 设置，在现有配置档案内选择渠道。可手填模型 ID，或用「刷新当前渠道」获取模型后选择。列表支持按开发商分组并搜索模型名称或 ID。「刷新全部模型」分别请求已配置档案和可用的默认渠道。云服务通常需要相应档案的 API Key。刷新失败时保留上次成功列表，刷新后继续保留正在使用的模型 ID。

模型目录显示服务端提供的上下文、价格、支持参数等信息。计价字段沿用服务端单位，例如 OpenRouter 返回的输入与输出价格通常以每 token 的美元价格表示。内置与远程参考目录只提供候选，账户可用性以实际测试 API 为准。

## OpenRouter

选择 OpenRouter 后填写该渠道的 API Key，刷新或搜索模型，再选择路由策略。指定供应商时使用模型端点目录中的 slug，并严格限制在该供应商。更换模型时重新选择可用供应商。若响应包含实际供应商，API 测试、审核诊断与启用后的请求日志会显示其名称。

高级参数接受 JSON，例如 `{"temperature":0.2,"top_p":0.9}`。还支持 `top_k`、`top_a`、`min_p`、`frequency_penalty`、`presence_penalty`、`repetition_penalty`、`seed` 和 `reasoning_max_tokens`。按当前模型或指定端点报告的参数能力发送。配置思考 token 预算时，需要开启思考并使用支持 `reasoning` 的模型。预算需低于请求输出上限，并优先于思考强度。

## 本地推理

Ollama 支持原生 `/api/tags`、`/api/show` 和 `/api/chat`。刷新只查询已安装的模型。「读取 Ollama 模型详情」按需获取能力及上下文信息。LM Studio、llama.cpp Server、vLLM、LocalAI 和其他兼容服务共用 Chat Completions 适配器。

默认地址使用当前设备的回环地址。服务运行在另一台电脑时，填写电脑的局域网地址，例如 `http://192.168.1.20:11434`，并让服务监听该网卡。使用扩展的「测试 API」检查连接、鉴权和标注响应。目标浏览器需要支持扩展及相应站点访问权限。移动设备访问电脑上的模型也应使用电脑的局域网地址。此仓库为浏览器扩展。若 Ollama 服务拒绝扩展来源，在服务端的 `OLLAMA_ORIGINS` 中加入对应的 `chrome-extension://扩展ID` 并重启服务。参见 [Ollama 本地服务配置](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama)。

## 参考配置更新

「更新 Models.dev 补充信息」按渠道和模型 ID 补充公开规格。Models.dev 条目只用于补充已选择或手动输入的模型，不加入可用模型列表。

可在「模型参考配置」中输入 HTTPS JSON 地址并手动更新。支持以下结构。

```json
{
  "schemaVersion": 1,
  "version": 2,
  "channels": [
    {
      "id": "openrouter",
      "defaults": {"effort": "medium", "stream": true},
      "models": [
        {
          "id": "example/model",
          "label": "Example Model",
          "developer": "Example",
          "contextLength": 8192,
          "thinking": "supported",
          "efforts": ["low", "medium"],
          "parameters": ["reasoning"],
          "mapping": "openrouter-reasoning"
        }
      ]
    }
  ]
}
```

可更新已有渠道的参考模型、能力、默认流式与思考强度。映射值只有内置的 `openrouter-reasoning`、`openrouter-effort`、`ollama-toggle` 和 `ollama-level`。配置导入会校验版本、字段和映射，保留上次成功配置供回滚。更新请求不带 API Key，配置无法指定鉴权、请求主机或可执行代码。

### 本地模型的思考设置

Ollama 从模型详情读取档位。LM Studio 优先从原生模型目录读取支持的档位，显式设置后使用原生 REST 聊天接口。llama.cpp、vLLM、LocalAI 和通用兼容接口可手动选择服务端支持的参数格式和强度。服务版本与模型模板决定参数是否生效。留在「服务端默认」时沿用原请求行为。

「刷新全部模型」同时更新 Models.dev 的参考资料，以及在「模型参考配置」中成功设置过的 HTTPS 规则源。未设置规则源时使用内置规则。下载失败会保留上一次成功的数据。规则配置可在渠道对象中新增 `"families":[{"base":"example-model","reference":"example-model"}]`，其中 reference 必须指向同渠道内带有明确 thinking 和 efforts 的模型。系列匹配只覆盖基础 ID 和数字日期后缀。可关闭的模型请用 thinking 为 toggle，单纯支持思考请用 supported。
