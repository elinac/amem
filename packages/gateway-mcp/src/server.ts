#!/usr/bin/env node
import { amemHome } from "@amem/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createToolHandlers } from "./handlers.js";

const home = process.env.AMEM_HOME ?? amemHome();
const tools = createToolHandlers(home);

const server = new Server({ name: "amem", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_recall",
      description: "Recall cross-session memories for the current task. Call at task start.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          task_type: { type: "string" },
          k: { type: "number" },
          session_id: { type: "string" },
          workspace_root: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_get",
      description: "Load full memory by id",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "memory_note",
      description: "Note a non-obvious lesson for future sessions",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          applies_when: { type: "string" },
          evidence_hint: { type: "string" },
        },
        required: ["kind", "title", "content", "applies_when"],
      },
    },
    {
      name: "memory_feedback",
      description: "Mark a recalled memory helpful or harmful",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["helpful", "harmful"] },
          reason: { type: "string" },
          decision_id: { type: "string" },
        },
        required: ["id", "verdict"],
      },
    },
    {
      name: "memory_flush",
      description: "Queue extract for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
      },
    },
    {
      name: "context_pack",
      description: "Build a budgeted context pack (pass epoch_id for fixed snapshot)",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          budget: { type: "number" },
          session_id: { type: "string" },
          epoch_id: { type: "string" },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const table = tools as Record<string, (a: unknown) => Promise<unknown>>;
  if (!Object.hasOwn(table, name)) {
    return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
  }
  try {
    const fn = table[name]!;
    return (await fn(args)) as {
      content: { type: "text"; text: string }[];
      isError?: boolean;
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "tool_failed", message }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
