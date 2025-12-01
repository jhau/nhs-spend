import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // Get tables with sizes
    const tables = await client.query(`
      SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    // Get columns
    const columns = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    
    // Get indexes
    const indexes = await client.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);
    
    // Get row counts
    const counts = await client.query(`
      SELECT relname as table_name, n_live_tup as row_count
      FROM pg_stat_user_tables
      ORDER BY relname
    `);
    
    // Get foreign keys
    const fks = await client.query(`
      SELECT
        tc.table_name, kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
    `);

    // Get sample data for context
    const orgSample = await client.query(`SELECT * FROM organisations LIMIT 3`);
    const spendSample = await client.query(`SELECT * FROM spend_entries LIMIT 3`);

    // Build markdown output
    let output = `# Database Schema Reference

Generated: ${new Date().toISOString()}

## Tables Overview

| Table | Rows | Size |
|-------|------|------|
`;

    const countMap: Record<string, number> = {};
    for (const row of counts.rows) {
      countMap[row.table_name] = row.row_count;
    }

    for (const table of tables.rows) {
      output += `| ${table.table_name} | ${countMap[table.table_name] || 0} | ${table.size} |\n`;
    }

    output += `\n## Table Columns\n`;

    // Group columns by table
    const columnsByTable: Record<string, typeof columns.rows> = {};
    for (const col of columns.rows) {
      if (!columnsByTable[col.table_name]) columnsByTable[col.table_name] = [];
      columnsByTable[col.table_name].push(col);
    }

    for (const [table, cols] of Object.entries(columnsByTable)) {
      output += `\n### ${table}\n\n`;
      output += `| Column | Type | Nullable | Default |\n`;
      output += `|--------|------|----------|--------|\n`;
      for (const col of cols) {
        output += `| ${col.column_name} | ${col.data_type} | ${col.is_nullable} | ${col.column_default || '-'} |\n`;
      }
    }

    output += `\n## Indexes\n\n`;
    for (const idx of indexes.rows) {
      output += `- **${idx.indexname}** on \`${idx.tablename}\`\n  \`\`\`sql\n  ${idx.indexdef}\n  \`\`\`\n`;
    }

    output += `\n## Foreign Keys\n\n`;
    for (const fk of fks.rows) {
      output += `- \`${fk.table_name}.${fk.column_name}\` → \`${fk.foreign_table_name}.${fk.foreign_column_name}\`\n`;
    }

    output += `\n## Sample Data\n\n### organisations (sample)\n\n\`\`\`json\n${JSON.stringify(orgSample.rows, null, 2)}\n\`\`\`\n`;
    output += `\n### spend_entries (sample)\n\n\`\`\`json\n${JSON.stringify(spendSample.rows, null, 2)}\n\`\`\`\n`;

    fs.writeFileSync("DATABASE_SCHEMA.md", output);
    console.log("Schema written to DATABASE_SCHEMA.md");
  } finally {
    client.release();
    await pool.end();
  }
}

main();

