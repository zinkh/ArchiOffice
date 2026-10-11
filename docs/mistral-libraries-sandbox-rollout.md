# Mistral Libraries — sandbox rollout

Test only with fictional documents. Keep production external sharing disabled.

Before implementing export: verify Mistral upload/delete API; store keys server-side; map remote IDs to tenant contributions; require explicit consent, human review, and separate transfer confirmation; prevent duplicates; audit uploads and remote deletion on withdrawal; test isolation across tenants, errors, retries, and retention. Obtain privacy/security approval before using customer data.

No external transmission is enabled by this document.

## Dedicated sandbox library

Mistral Console: https://console.mistral.ai/libraries/01a12a77-dd1c-77eb-84b0-25cac8adccf4
Library ID: `01a12a77-dd1c-77eb-84b0-25cac8adccf4`

Suggested server-side configuration (never commit API credentials):

```env
MISTRAL_KNOWLEDGE_LIBRARY_ID=01a12a77-dd1c-77eb-84b0-25cac8adccf4
MISTRAL_KNOWLEDGE_PUBLISH_ENABLED=false
# MISTRAL_API_KEY must be configured in the deployment secret manager
```

The library identifier alone does not grant access; confirm the API key belongs to the workspace that owns this library. Do not enable production publishing yet.
