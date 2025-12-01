# AntV Chart MCP Integration Guide

This project now integrates with the [AntV Chart MCP Server](https://github.com/antvis/mcp-server-chart) to enable automatic chart generation from your NHS spending data.

## What's New

### 1. Chart Generation Capabilities

Your AI assistant can now generate **25+ types of charts**, including:

- **Basic Charts**: Line, Bar, Column, Pie, Area
- **Statistical Charts**: Box plot, Violin plot, Histogram, Scatter
- **Advanced Visualizations**: Heatmap, Treemap, Sankey diagram, Radar chart
- **Specialized Charts**: Word cloud, Venn diagram, Funnel chart, Gauge
- **Diagrams**: Mind map, Fishbone diagram, Organization chart
- **Geographic Maps**: District map, Path map, Pin map (China only)

### 2. How It Works

The integration uses two MCP servers working together:

```
User Question
     ↓
AI Agent
     ↓
   ┌─────────────────────────────────────┐
   │                                     │
   ↓                                     ↓
Postgres MCP                      Chart MCP
(Query Data)                   (Generate Charts)
   │                                     │
   └─────────────→ Results ←─────────────┘
```

### 3. Example Interactions

#### Simple Query with Chart
**User**: "Show me the top 10 NHS trusts by total spending"

**Agent**:
1. Queries the database for top 10 trusts
2. Generates a bar chart visualizing the data
3. Returns both the data and the chart image

#### Trend Analysis
**User**: "What's the spending trend over the last 12 months?"

**Agent**:
1. Queries monthly spending data
2. Generates a line chart showing the trend
3. Highlights key insights (increases, decreases)

#### Comparison Charts
**User**: "Compare spending across different categories"

**Agent**:
1. Aggregates spending by category
2. Generates a pie chart or stacked bar chart
3. Shows percentage breakdown

## Setup

### 1. Start the MCP Servers

```bash
# Start both Postgres and Chart MCP servers
pnpm mcp:up

# View logs to confirm they're running
pnpm mcp:logs
```

Expected output:
```
postgres-mcp   | Server running on http://0.0.0.0:8000
chart-mcp      | Server running on http://0.0.0.0:1122
```

### 2. Verify Environment Variables

Ensure your `.env` file includes:

```bash
MCP_POSTGRES_URL=http://localhost:8000/sse
MCP_CHART_URL=http://localhost:8001/sse
OPENAI_API_KEY=sk-...
```

### 3. Start the Development Server

```bash
pnpm dev
```

### 4. Test Chart Generation

Open [http://localhost:3000](http://localhost:3000) and try these queries:

1. "What are the top 5 organizations by spending? Show me a chart."
2. "Create a pie chart of spending by expense type"
3. "Show me a line chart of monthly spending trends"

## Available Chart Types

Here are some commonly used chart generation tools:

| Tool | Description | Best For |
|------|-------------|----------|
| `generate_line_chart` | Line chart | Time series, trends |
| `generate_bar_chart` | Horizontal bar chart | Comparisons, rankings |
| `generate_column_chart` | Vertical bar chart | Categorical data |
| `generate_pie_chart` | Pie chart | Proportions, percentages |
| `generate_area_chart` | Area chart | Cumulative values over time |
| `generate_scatter_chart` | Scatter plot | Correlations, distributions |
| `generate_heatmap` | Heatmap | Matrix data, patterns |
| `generate_treemap_chart` | Treemap | Hierarchical data |
| `generate_histogram` | Histogram | Data distribution |
| `generate_box_plot` | Box plot | Statistical summary |

## Advanced Configuration

### Disable Specific Chart Types

If you want to limit which charts the AI can generate, add to your `.env`:

```bash
# In docker-compose.mcp.yml, add under chart-mcp environment:
DISABLED_TOOLS=generate_fishbone_diagram,generate_mind_map
```

### Private Deployment

For secure/private environments, you can deploy your own chart rendering service:

1. Deploy [GPT-Vis-SSR](https://github.com/antvis/GPT-Vis) to your infrastructure
2. Update `docker-compose.mcp.yml`:

```yaml
chart-mcp:
  environment:
    VIS_REQUEST_SERVER: "https://your-server.com/api/chart"
```

### Save Chart Generation Records

To track chart generation history:

1. Visit the AntV mini program (scan QR code in their docs)
2. Generate a SERVICE_ID
3. Add to `docker-compose.mcp.yml`:

```yaml
chart-mcp:
  environment:
    SERVICE_ID: "your-service-id-here"
```

## Troubleshooting

### Charts Not Generating

1. **Check MCP servers are running**:
   ```bash
   docker ps
   ```
   Should show both `postgres-mcp` and `chart-mcp` containers.

2. **Check server logs**:
   ```bash
   pnpm mcp:logs
   ```

3. **Verify URLs are accessible**:
   ```bash
   curl http://localhost:8000/sse
   curl http://localhost:8001/sse
   ```

### Connection Errors

If you see "Failed to fetch MCP tools":

1. Restart the MCP servers:
   ```bash
   pnpm mcp:restart
   ```

2. Check your `.env` file has the correct URLs

3. Make sure ports 8000 and 8001 aren't already in use

### Chart Quality Issues

The AI chooses chart types automatically. You can guide it by being specific:

- ❌ "Show me the data"
- ✅ "Show me the data as a bar chart"
- ✅ "Create a line chart showing the trend"

## Development Notes

### File Changes Made

1. **`docker-compose.mcp.yml`**
   - Added `chart-mcp` service using `antv/mcp-server-chart:latest`
   - Configured SSE transport on port 8001

2. **`src/app/api/chat/route.ts`**
   - Updated to connect to both MCP servers
   - Enhanced system prompt to guide chart generation
   - Added chart generation workflow instructions

3. **`package.json`**
   - Updated `mcp:up` to start all services
   - Added convenience scripts for logs and restart

4. **`README.md`**
   - Documented the dual MCP server setup
   - Added chart generation capabilities overview
   - Updated environment variable requirements

### Architecture

The system uses LangChain's `MultiServerMCPClient` to connect to multiple MCP servers simultaneously. The agent automatically decides when to:

1. Query the database (using Postgres MCP tools)
2. Generate charts (using Chart MCP tools)
3. Combine both to provide data-driven visualizations

### Adding More MCP Servers

To add additional MCP servers, follow this pattern in `route.ts`:

```typescript
const mcpClient = new MultiServerMCPClient({
  postgres: { transport: "sse", url: MCP_POSTGRES_URL },
  chart: { transport: "sse", url: MCP_CHART_URL },
  newServer: { transport: "sse", url: MCP_NEW_SERVER_URL },
});
```

## Resources

- [AntV Chart MCP Server](https://github.com/antvis/mcp-server-chart)
- [AntV Visualization Library](https://antv.vision/)
- [Model Context Protocol Docs](https://modelcontextprotocol.io/)
- [LangChain MCP Adapters](https://js.langchain.com/docs/integrations/mcp-adapters)

## Support

For issues with:
- **Chart generation**: See [AntV MCP issues](https://github.com/antvis/mcp-server-chart/issues)
- **Database queries**: See Postgres MCP documentation
- **Integration/app**: Open an issue in this repository


