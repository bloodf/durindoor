# Optional self-hosted tunnel relay

This relay is optional. DurinDoor ships no project-operated or shared default relay. The current app in this checkout does not yet send an ownership secret and hardcodes its public relay domain, so it cannot use this worker without the separate app integration. Do not point it at this worker expecting stable URLs to work.

## Deploy

1. In your own Cloudflare account, create a KV namespace using `wrangler kv namespace create RELAY_KV`. Copy its ID into `wrangler.toml` and set `RELAY_HOST` to a hostname in your zone.
2. Configure Worker routes for both `relay.example.com/*` and `*.relay.example.com/*` (substitute your hostname), and ensure DNS and TLS cover both names. Deploy from this directory using `wrangler deploy` with your own Cloudflare credentials.
3. Generate a unique random ownership secret of at least 32 characters and keep it private and persistent. Register with `POST https://relay.example.com/api/tunnel/register`, JSON body `{"shortId":"abc123","tunnelUrl":"https://example.trycloudflare.com","ownershipSecret":"YOUR_SECRET"}`. Use the same secret to change that ID's URL. A missing or incorrect secret on overwrite returns 403; a secret under 32 characters returns 400. First registration claims the ID, so register before exposing it to others.
4. Requests to `https://rabc123.relay.example.com/path` forward to the registered HTTPS origin with the path and query preserved. The destination must be an HTTPS origin without credentials, path, query or fragment.

The relay terminates TLS and sees plaintext traffic, including credentials and request bodies. Operate it only in an account you trust and protect access to your gateway separately. Anyone who learns a secret can change that ID's destination; losing it means that ID cannot be updated. The Durable Object storage is authoritative and serializes claims and updates per ID; KV is a mirror, not an authorization source, because KV is eventually consistent. Preserve both bindings and Durable Object data across deployments. A failed KV write can return an error after the authoritative update; retry with the same secret.
