## NHS Spend Explorer

Next.js app with a Postgres back end wired up through Drizzle ORM. Data import pipelines can load NHS spending spreadsheets into the database, and the app exposes an API endpoint that uses the typed Drizzle client.

## Prerequisites

- Node.js 20+
- `pnpm` 9+
- A running Postgres instance accessible via `DATABASE_URL`

## Installation

```bash
pnpm install
```

## Environment Variables

Create a `.env` file in the project root with at least:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/nhs_spend
DOCKER_DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/nhs_spend
OPENAI_API_KEY=sk-...
MCP_POSTGRES_URL=http://localhost:8000/sse
MCP_CHART_URL=http://localhost:8001/sse
COMPANIES_HOUSE_RATE_LIMIT_MS=600
```

Adjust the connection string to match your environment. The Drizzle CLI, runtime client, and MCP sidecar all require it.

## Database Toolkit

Drizzle is configured through `drizzle.config.ts` using the schema at `src/db/schema.ts`. Helpful commands:

```bash
pnpm db:generate   # create SQL migrations from the schema
pnpm db:push       # apply the latest schema directly to the database
pnpm db:migrate    # run generated migrations against the database
pnpm db:introspect # introspect an existing database into schema files
```

Run these with the `DATABASE_URL` set. Generated migrations will appear under `./drizzle`.

## Development Server

```bash
pnpm dev
```

Navigate to [http://localhost:3000](http://localhost:3000) to open the chat interface powered by the Vercel AI SDK. The assistant connects to two MCP servers:
1. **Postgres MCP** (`MCP_POSTGRES_URL`) - for querying the NHS spending database
2. **AntV Chart MCP** (`MCP_CHART_URL`) - for generating visualizations (25+ chart types)

The assistant can query data and automatically generate charts to visualize the results.

## MCP Servers (Required)

The application uses two MCP servers for enhanced functionality:

### Starting MCP Servers

Start both MCP servers with a single command:

```bash
pnpm mcp:up
```

This launches:
1. **Postgres MCP Server** ([`crystaldba/postgres-mcp`](https://mcpservers.org/servers/crystaldba/postgres-mcp))
   - Bound to `http://localhost:8000/sse`
   - Configured in read-only mode
   - Provides database query capabilities

2. **AntV Chart MCP Server** ([`antv/mcp-server-chart`](https://github.com/antvis/mcp-server-chart))
   - Bound to `http://localhost:8001/sse`
   - Provides 25+ chart generation tools including:
     - Line charts, bar charts, pie charts
     - Area charts, scatter plots, heatmaps
     - Treemaps, sankey diagrams, radar charts
     - And many more visualization types

### Managing MCP Servers

```bash
pnpm mcp:down      # Stop all MCP servers
pnpm mcp:logs      # View logs from all MCP servers
pnpm mcp:restart   # Restart all MCP servers
```

### Docker Configuration

The MCP servers are defined in `docker-compose.mcp.yml`. You can customize the chart server by adding environment variables:

- `VIS_REQUEST_SERVER`: Custom chart generation service URL for private deployment
- `SERVICE_ID`: Service identifier for saving chart generation records
- `DISABLED_TOOLS`: Comma-separated list of chart tools to disable

You can point external MCP-aware tooling (Claude Desktop, Cursor, etc.) at the running endpoints.

## Next Steps

- Populate `src/db/schema.ts` with additional tables that match your NHS spending model.
- Build ingestion jobs (upload UI, background worker, or CLI) that parse spreadsheets and persist to the Drizzle models.
- Connect an MCP SQL server to the same Postgres database so the LLM can answer spending questions.

## Importing NHS Spend Data

Use the bundled script to ingest the workbook located in the `@data` directory into Postgres:

```bash
pnpm data:import -- --file "/Users/jeff/work/github/nhs-spend/data/1_England_NHS_Trust_Spend_Data_(1- 23).xlsx"
```

- Add `--truncate` to clear existing `spend_entries` rows before loading.
- The script synchronises the `organisations` table from the `Trusts` sheet and creates any missing trusts found in data sheets.
- Payment dates formatted as `YY-MMM` (for example `22-Apr`) are interpreted as the first day of that month (`2022-04-01`).
- Amounts are normalised, currency symbols are stripped, and raw values are stored alongside the parsed numeric amount for auditing.
