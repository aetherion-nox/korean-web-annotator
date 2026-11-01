# Qwen support — verified 2026-10-27

Built on Korean Web Annotator 1.1.1, packaged as 1.1.2. Existing local dictionary rules and mixed-origin alignment fixes remain in place.

## Configuration

Choose **Qwen 千问（阿里云百炼）** as the provider. The preset uses the still-supported Beijing endpoint:

`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

The endpoint field accepts a **full Chat Completions URL**, not an SDK base URL. You can replace it with the workspace-specific full URL shown in the Alibaba Cloud console, for example:

`https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`

Other documented regions use `ap-southeast-1` (Singapore), `us-east-1` (Virginia), or `ap-northeast-1` (Tokyo). The legacy Singapore host `dashscope-intl.aliyuncs.com` is recognized too. Use an API Key issued in the same region as the endpoint. Model availability and billing depend on the region and your account.

This adapter targets Alibaba Cloud Model Studio's OpenAI-compatible **Chat Completions** API. It is not a native DashScope Generation/MultimodalGeneration adapter, a Qwen website login, or a universal adapter for third-party/local Qwen deployments.

## Model controls

- Qwen3.8 Max/Flash and documented open variants expose `low`, `medium`, `xhigh`; turning thinking off sends `enable_thinking: false` and no effort value. Effort and thinking_budget are never sent together.
- Qwen3.7 Max/Plus/Flash and Qwen3.6/3.5 Plus/Flash, Qwen Plus/Flash/Turbo expose a thinking toggle, without inventing unsupported effort levels.
- Qwen3.7 Max Preview and Qwen3.8 2.4T thinking-only models cannot be disabled. The toggle is hidden, and stale saved values cannot disable thinking.
- Qwen Max receives no thinking parameters. Unlisted custom model names use server defaults, with streaming, and no guessed thinking/JSON-mode parameters.
- Known thinking requests stream. Documented stream-only open models stream in both modes. Known non-thinking commercial requests can use ordinary JSON responses.
- JSON Object is requested for supported non-thinking models, and for Qwen3.8/Qwen3.7 models documented to support thinking JSON. Earlier thinking models receive the JSON instruction without forcing JSON mode. Their final answer must still be valid JSON and pass local candidate-ID validation.

## Output handling

Only `delta.content` / `message.content` is parsed as the answer. `reasoning_content` is not included. The SSE parser handles UTF-8 chunk boundaries, CRLF framing, usage-only events and the DONE marker. Truncation, incomplete streams, API errors, invalid JSON and unknown candidate IDs leave the target unresolved. No extra model call is made to rewrite invalid output. Existing bounded retry logic remains.

The request timeout defaults to 120 seconds for Qwen. The existing test-connection button uses the same request and fixed-choice protocol as real model review.

## Verification

Mock HTTP contract tests cover request parameters, auth, stream/ordinary responses, errors, truncation, unknown IDs and non-Qwen request compatibility. Existing alignment/cache tests and actual bundled Kiwi WASM + Pyodide + SQLite smoke tests also run. No paid Qwen API request or real browser installation was performed; no user credential was available or used.

## Official references

- https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope — endpoints, legacy-host compatibility, regional keys
- https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions — HTTP parameter placement, reasoning_effort, streaming schema
- https://help.aliyun.com/zh/model-studio/deep-thinking — model-specific thinking controls, stream-only models, reasoning_content
- https://help.aliyun.com/zh/model-studio/qwen-structured-output — JSON support by model and thinking mode

Sources reviewed on 2026-10-27. Other providers' catalog verification date remains separate and has not been advanced by this change.
