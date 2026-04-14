# API Integration Patterns & Templates

This document provides common patterns and templates for API integrations.

---

## Authentication Patterns

### Pattern 1: REST API with API Key

```typescript
const headers = {
  'Authorization': `Bearer ${process.env.API_KEY}`,
  'Content-Type': 'application/json'
};

const response = await fetch(`${baseUrl}/endpoint`, {
  method: 'POST',
  headers,
  body: JSON.stringify(data)
});
```

### Pattern 2: OAuth 2.0

```typescript
// Step 1: Get access token
const tokenResponse = await fetch('/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET
  })
});

const { access_token } = await tokenResponse.json();

// Step 2: Use access token
const headers = {
  'Authorization': `Bearer ${access_token}`,
  'Content-Type': 'application/json'
};
```

### Pattern 3: Webhook Integration

```typescript
// Register webhook
await client.registerWebhook({
  url: 'https://yourdomain.com/api/webhooks/[api-name]',
  events: ['event.type1', 'event.type2']
});

// Handle webhook (API Route)
export async function POST(request: Request) {
  const payload = await request.json();
  
  // Verify signature (if provided by API)
  const signature = request.headers.get('X-API-Signature');
  if (!verifySignature(payload, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }
  
  // Process webhook
  await handleWebhookEvent(payload);
  
  return new Response('OK', { status: 200 });
}
```

---

## Client Structure Template

```typescript
// src/lib/integrations/[api-name]/client.ts

import { [APIName]Config, [APIName]Response } from './types';
import { [APIName]Error } from './errors';

export class [APIName]Client {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: [APIName]Config) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      throw new [APIName]Error(
        `API request failed: ${response.statusText}`,
        response.status
      );
    }

    return response.json();
  }

  async [methodName](data: [InputType]): Promise<[OutputType]> {
    return this.request<[OutputType]>('/endpoint', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}
```

---

## Type Definitions Template

```typescript
// src/lib/integrations/[api-name]/types.ts

export interface [APIName]Config {
  apiKey: string;
  baseUrl: string;
}

export interface [APIName]Request {
  field1: string;
  field2?: number;
}

export interface [APIName]Response {
  id: string;
  status: string;
  data: unknown;
}
```

---

## Error Handling Template

```typescript
// src/lib/integrations/[api-name]/errors.ts

export class [APIName]Error extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = '[APIName]Error';
  }
}

// Usage
try {
  await client.[methodName](data);
} catch (error) {
  if (error instanceof [APIName]Error) {
    console.error('API Error:', error.message, error.statusCode);
    // Handle specific status codes
    if (error.statusCode === 429) {
      // Rate limit - retry with backoff
    }
  }
  throw error;
}
```

---

## Configuration Template

```typescript
// src/lib/integrations/[api-name]/config.ts

export const [apiName]Config = {
  apiKey: process.env.[API_NAME]_API_KEY!,
  baseUrl: process.env.[API_NAME]_BASE_URL || 'https://api.default.com',
  timeout: 10000,
  retries: 3,
};

// Validation
if (!process.env.[API_NAME]_API_KEY) {
  throw new Error('[API_NAME]_API_KEY is required');
}
```

---

## Retry Logic Template

```typescript
// src/lib/integrations/[api-name]/retry.ts

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on client errors (4xx)
      if (error instanceof [APIName]Error && error.statusCode < 500) {
        throw error;
      }

      // Exponential backoff
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }

  throw lastError!;
}

// Usage
const result = await withRetry(() => client.[methodName](data));
```

---

## README Template

```markdown
# [API Name] Integration

Integration with [API Name] for [purpose].

## Setup

1. Add environment variables to `.env.local`:
   ```
   [API_NAME]_API_KEY=your_api_key_here
   [API_NAME]_BASE_URL=https://api.example.com
   ```

2. Import and use the client:
   ```typescript
   import { [APIName]Client } from '@/lib/integrations/[api-name]';
   
   const client = new [APIName]Client({
     apiKey: process.env.[API_NAME]_API_KEY!,
     baseUrl: process.env.[API_NAME]_BASE_URL!,
   });
   ```

## Usage

### [Method Name]

```typescript
const result = await client.[methodName]({
  field1: 'value',
  field2: 123,
});
```

## Error Handling

```typescript
try {
  await client.[methodName](data);
} catch (error) {
  if (error instanceof [APIName]Error) {
    console.error('API Error:', error.message, error.statusCode);
  }
}
```

## Rate Limits

- [X] requests per [time period]
- Automatic retry with exponential backoff

## Documentation

- Official Docs: [URL]
- API Reference: [URL]
```

---

## MCP Server Template (opcional)

Crie MCP server quando a API expõe recursos/ações que devem estar disponíveis a agentes AI sob protocolo padronizado.

**Estrutura:** `src/lib/mcp-servers/[api-name]/`

### Entry point

```typescript
// src/lib/mcp-servers/[api-name]/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { [APIName]Client } from '@/lib/integrations/[api-name]';
import { registerResources } from './resources';
import { registerTools } from './tools';

const server = new Server(
  { name: '[api-name]-mcp-server', version: '1.0.0' },
  { capabilities: { resources: {}, tools: {} } }
);

const apiClient = new [APIName]Client({
  apiKey: process.env.[API_NAME]_API_KEY!,
  baseUrl: process.env.[API_NAME]_BASE_URL!,
});

registerResources(server, apiClient);
registerTools(server, apiClient);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Resources

```typescript
// src/lib/mcp-servers/[api-name]/resources.ts
export function registerResources(server, apiClient) {
  server.setRequestHandler('resources/list', async () => ({
    resources: [
      { uri: '[api-name]://items', name: 'Items List', mimeType: 'application/json' },
    ],
  }));

  server.setRequestHandler('resources/read', async (request) => {
    if (request.params.uri === '[api-name]://items') {
      const items = await apiClient.listItems();
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(items, null, 2),
        }],
      };
    }
  });
}
```

### Tools

```typescript
// src/lib/mcp-servers/[api-name]/tools.ts
export function registerTools(server, apiClient) {
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'create_item',
        description: 'Create a new item',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name'],
        },
      },
    ],
  }));

  server.setRequestHandler('tools/call', async (request) => {
    if (request.params.name === 'create_item') {
      const result = await apiClient.createItem(request.params.arguments);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  });
}
```

### package.json script

```json
{
  "scripts": {
    "mcp:[api-name]": "node --loader ts-node/esm src/lib/mcp-servers/[api-name]/index.ts"
  }
}
```

### Client MCP config

```json
{
  "mcpServers": {
    "[api-name]": {
      "command": "npm",
      "args": ["run", "mcp:[api-name]"],
      "env": { "[API_NAME]_API_KEY": "your_key_here" }
    }
  }
}
```

---

## Webhook Handler Template

Use quando a API notifica eventos via HTTP POST. **Sempre** verifique a assinatura antes de processar o payload.

### Route handler (Next.js 15)

```typescript
// src/app/api/webhooks/[api-name]/route.ts
import { headers } from 'next/headers';
import { [APIName]Webhook } from '@/lib/integrations/[api-name]/webhook';

export async function POST(request: Request) {
  try {
    const headersList = await headers();
    const signature = headersList.get('x-[api-name]-signature');
    if (!signature) return new Response('Missing signature', { status: 401 });

    const body = await request.text();
    const isValid = [APIName]Webhook.verifySignature(body, signature);
    if (!isValid) return new Response('Invalid signature', { status: 401 });

    const payload = JSON.parse(body);
    await handleWebhookEvent(payload);
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('[API Name] webhook error:', error);
    return new Response('Internal error', { status: 500 });
  }
}

async function handleWebhookEvent(payload: any) {
  const eventType = payload.type || payload.event;
  switch (eventType) {
    case 'event.type1': /* handle */ break;
    case 'event.type2': /* handle */ break;
    default: console.log('Unhandled event:', eventType);
  }
}
```

### Signature verification (HMAC SHA256)

```typescript
// src/lib/integrations/[api-name]/webhook.ts
import crypto from 'crypto';

export class [APIName]Webhook {
  static verifySignature(body: string, signature: string): boolean {
    const secret = process.env.[API_NAME]_WEBHOOK_SECRET!;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }
}
```

### .env.example

```
[API_NAME]_WEBHOOK_SECRET=your_webhook_secret_here
```

### Teste local com ngrok

```bash
ngrok http 3000
# Use a URL do ngrok no dashboard da API para testar entrega de webhook
```

---

## Smoke test manual

Este framework **não** envia suíte automatizada. Valide toda integração com um script manual antes de marcar como completa.

```typescript
// src/lib/integrations/[api-name]/test-manual.ts
import { [APIName]Client } from './client';

async function testIntegration() {
  const client = new [APIName]Client({
    apiKey: process.env.[API_NAME]_API_KEY!,
    baseUrl: process.env.[API_NAME]_BASE_URL!,
  });

  try {
    const result = await client.[testMethod]();
    console.log('Integration OK:', result);
  } catch (error) {
    console.error('Integration FAILED:', error);
    process.exit(1);
  }
}

testIntegration();
```

Rode:

```bash
npx tsx src/lib/integrations/[api-name]/test-manual.ts
```

**Checklist de validação manual:**
- [ ] Auth funciona com credenciais válidas
- [ ] Request bem-sucedido retorna dados esperados
- [ ] Client lança erros tipados em 4xx
- [ ] Retry logic dispara em 5xx
- [ ] Erros não vazam segredos no log

Se precisar de cobertura de regressão contínua, invoque `@qa` on-demand — ele instala infra mínima escopada ao pedido.
