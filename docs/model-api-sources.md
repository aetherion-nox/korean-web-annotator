# Model API compatibility

Verified against official documentation on 2026-10-12.

| Provider / model | Thinking control | Request API |
| --- | --- | --- |
| OpenAI GPT-6 Astra, GPT-6.1 Sol | Required; low, medium, high, xhigh, max | Responses by default; Chat Completions supported |
| OpenAI GPT-6 Luna | Can disable using none; otherwise low, medium, high, xhigh, max | Responses by default; Chat Completions supported |
| Claude Fable 5.1, Opus 5.5 | Adaptive thinking required; low, medium, high, xhigh, max | Messages |
| Claude Sonnet 5.5 | Adaptive, or between_tools to disable up-front thinking | Messages |
| Claude Haiku 5.5 | Adaptive, or disabled | Messages |

Sonnet's between_tools and Haiku's disabled modes are restricted to high effort or below. The extension uses low effort when disabling thinking and hides the effort selector in that mode. Unknown custom models use server defaults. No sampling parameters are sent. Native requests allow up to 16,384 output tokens (including reasoning) and have a 120-second timeout; truncated results are rejected. Candidate IDs are still validated locally.

Sources:

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/build-with-claude/thinking
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/api/messages/create

Validation uses mocked HTTP responses to verify request schemas, authentication, parsing, and UI capabilities. No paid OpenAI or Claude request was made.
