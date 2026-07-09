import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.ts";

async function callMcp(method, params) {
  const request = new Request("http://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const response = await worker.fetch(request);
  return response.json();
}

function callTool(argumentsValue, name = "validate_required_fields") {
  return callMcp("tools/call", { name, arguments: argumentsValue });
}

describe("Required Fields Validator Worker", () => {
  it("serves root and health routes", async () => {
    const root = await worker.fetch(new Request("http://example.com/"));
    const health = await worker.fetch(new Request("http://example.com/health"));
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type"), /^text\/html/);
    assert.match(await root.text(), /Required Fields Validator/);
    assert.deepEqual(await health.json(), { status: "ok" });
  });

  it("serves the complete review shell with consistent navigation", async () => {
    for (const path of ["/", "/privacy", "/terms", "/support"]) {
      const response = await worker.fetch(new Request(`http://example.com${path}`));
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^text\/html/);
      assert.match(html, /href="\/">Home<\/a>/);
      assert.match(html, /href="\/privacy">Privacy<\/a>/);
      assert.match(html, /href="\/terms">Terms<\/a>/);
      assert.match(html, /href="\/support">Support<\/a>/);
      assert.match(html, /Required Fields Validator/);
      assert.match(html, /Check whether submitted field data includes required field names\./);
      assert.doesNotMatch(html, /placeholder|TODO|lorem ipsum/i);
    }
  });

  it("returns the raw challenge value as plain text", async () => {
    const response = await worker.fetch(
      new Request("http://example.com/.well-known/openai-apps-challenge"),
      { OPENAI_APPS_CHALLENGE: "challenge-test-value" }
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/plain/);
    assert.equal(await response.text(), "challenge-test-value");
  });

  it("initializes with MCP capabilities", async () => {
    const body = await callMcp("initialize");
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, 1);
    assert.deepEqual(body.result.capabilities, { tools: {} });
  });

  it("lists only validate_required_fields and its contract", async () => {
    const body = await callMcp("tools/list");
    assert.equal(body.result.tools.length, 1);
    const tool = body.result.tools[0];
    assert.equal(tool.name, "validate_required_fields");
    assert.equal(tool.title, "Validate Required Fields");
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    assert.equal(tool.inputSchema.properties.required_fields.minItems, undefined);
    assert.ok(tool.outputSchema.required.includes("errors"));
  });

  it("returns a complete positive result", async () => {
    const body = await callTool({
      submitted_fields: {
        name: "Alice",
        email: "alice@example.com",
        order_id: "A1001"
      },
      required_fields: ["name", "email", "order_id"],
      source_label: "return_request_form"
    });
    assert.deepEqual(body.result.structuredContent, {
      status: "success",
      is_complete: true,
      missing_fields: [],
      present_fields: ["name", "email", "order_id"],
      source_label: "return_request_form",
      errors: []
    });
  });

  it("reports a missing field", async () => {
    const body = await callTool({
      submitted_fields: { name: "Alice", email: "alice@example.com" },
      required_fields: ["name", "email", "order_id"],
      source_label: "return_request_form"
    });
    assert.equal(body.result.structuredContent.status, "success");
    assert.equal(body.result.structuredContent.is_complete, false);
    assert.deepEqual(body.result.structuredContent.missing_fields, ["order_id"]);
  });

  it("returns empty_input", async () => {
    const body = await callTool({
      submitted_fields: {},
      required_fields: [],
      source_label: ""
    });
    assert.equal(body.result.structuredContent.errors[0].code, "empty_input");
    assert.equal(body.result.structuredContent.errors[0].field, "required_fields");
  });

  it("returns invalid_input_type", async () => {
    const body = await callTool({
      submitted_fields: {},
      required_fields: "name,email",
      source_label: ""
    });
    const output = body.result.structuredContent;
    assert.equal(output.status, "error");
    assert.equal(output.is_complete, false);
    assert.equal(output.errors[0].code, "invalid_input_type");
    assert.equal(output.errors[0].field, "required_fields");
  });

  it("returns out_of_scope for external action requests", async () => {
    const body = await callTool({
      submitted_fields: {},
      required_fields: [],
      source_label: "",
      action: "submit form and approve request"
    });
    assert.equal(body.result.structuredContent.errors[0].code, "out_of_scope");
  });

  it("returns a unified error for an unknown tool", async () => {
    const body = await callTool({}, "unknown_tool");
    assert.equal(body.result.structuredContent.status, "error");
    assert.equal(body.result.structuredContent.is_complete, false);
    assert.deepEqual(body.result.structuredContent.missing_fields, []);
    assert.deepEqual(body.result.structuredContent.present_fields, []);
    assert.equal(body.result.structuredContent.source_label, "");
    assert.equal(body.result.structuredContent.errors[0].code, "out_of_scope");
    assert.equal(body.result.structuredContent.errors[0].field, "name");
  });
});
