# DeepInfra video, embeddings and rerank

DeepInfra (`deepinfra`) is a chat provider whose existing API-key connection
also serves native video generation, text embeddings and rerank. Chat keeps
its OpenAI-compatible transport and live model list.

## Connect

1. Open **Dashboard → Providers → DeepInfra** and choose **Add Connection**.
2. Paste an API key from https://deepinfra.com/dash/api_keys and save.

The selected connection's key is sent as `Authorization: Bearer <key>`, and
only to `https://api.deepinfra.com`. A base URL saved on the connection does
not change that host for video, embeddings or rerank, and redirects are
refused. Connection proxy settings apply.

## Models

| Kind | Endpoint | Models |
| --- | --- | --- |
| Video | `POST /v1/video/generations` | `deepinfra/Wan-AI/Wan2.2-T2V-A14B`, `deepinfra/Wan-AI/Wan2.2-TI2V-5B`, `deepinfra/Wan-AI/Wan2.7-T2V`, `deepinfra/Lightricks/LTX-2.3-Distilled` |
| Embedding | `POST /v1/embeddings` | `deepinfra/Qwen/Qwen3-Embedding-8B`, `-4B`, `-0.6B`, `deepinfra/BAAI/bge-large-en-v1.5`, `deepinfra/BAAI/bge-base-en-v1.5`, `deepinfra/BAAI/bge-m3`, `deepinfra/intfloat/e5-large-v2`, `deepinfra/thenlper/gte-large` |
| Rerank | `POST /v1/rerank` | `deepinfra/Qwen/Qwen3-Reranker-8B`, `-4B`, `-0.6B` |

`/v1/models/video`, `/v1/models/embedding` and `/v1/models/rerank` list these
rows. The chat model list from DeepInfra's `/v1/openai/models` is unchanged and
never adds media rows. Other embedding or rerank models can be named as
`deepinfra/<organization>/<model>`; they are sent as given, with no claim
about what they support. A listed model of one kind is refused on another
kind's route.

## Video

Send `model` and `prompt` (at most 8,000 characters). Optional:
`negative_prompt`, `seed` (integer 0–4294967295), `n: 1` and
`response_format: "url"`. Only `Wan-AI/Wan2.2-TI2V-5B` accepts an input image,
as `image` or `image_url`: a public `https` URL, or a base64 PNG, JPEG or WebP
data URL up to 10 MiB.

DeepInfra renders synchronously; one request waits up to 10 minutes. The
response is `{ created, data: [{ url, format: "mp4" }] }`. The result URL is
returned without being downloaded. Streaming, other output formats,
`duration`, size and any other field are refused before anything is sent.

## Embeddings

Send `model` and `input`: one string or up to 2,048 non-empty strings, each at
most 20,000 characters. Optional: `dimensions` and `encoding_format: "float"`.
Token arrays, base64 output, media inputs and any other field (such as `user`
or `input_type`) are refused before anything is sent. The response is the
OpenAI list shape, ordered by `index`, with DeepInfra's own token and cost
receipt when it returns one.

## Rerank

Send `model`, `query` and `documents` (strings or `{ text }` objects, up to
2,048). Optional: `top_n` (1 to the number of documents) and
`return_documents` (boolean, default true). DeepInfra scores every document;
the gateway sorts by score and returns
`{ id, results: [{ index, relevance_score, document? }] }` without inventing
billed units. Other fields are refused before anything is sent.

## Deadlines, results and usage

Embeddings and rerank allow 30 seconds per request, including the body read.
Usage is recorded once per success on the selected connection, with
DeepInfra's numeric token and cost receipt when present and unknown cost
otherwise.

A request whose outcome is unknown (a server error, a timeout, a cancellation
after the send, an answer from another origin, or a success without a usable
result) is recorded once on the selected connection and is never retried on
another account, model, fallback model or combo member. No credential is
refreshed or rewritten. A refused key returns 401; a spent balance returns 402
and marks only the selected connection, so another connection can still serve
the next request; a rate limit returns 429 with its reset when given. Error
messages never echo the key or DeepInfra's error text.
