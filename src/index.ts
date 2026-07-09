const TOOL_NAME = "validate_required_fields";
const APP_NAME = "Required Fields Validator";
const SUPPORT_EMAIL = "sidcraigau@gmail.com";
const USE_CASE = "Check whether submitted field data includes required field names.";

interface Env {
  OPENAI_APPS_CHALLENGE?: string;
}

type ErrorCode =
  | "missing_required_input"
  | "invalid_input_type"
  | "empty_input"
  | "out_of_scope"
  | "internal_error";

interface ToolError {
  code: ErrorCode;
  message: string;
  field: string;
}

interface ToolOutput {
  status: "success" | "error";
  is_complete: boolean;
  missing_fields: string[];
  present_fields: string[];
  source_label: string;
  errors: ToolError[];
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const inputSchema = {
  type: "object",
  description: "Inputs used to check submitted field data against required field names.",
  properties: {
    submitted_fields: {
      type: "object",
      description: "Submitted field names and their values.",
      additionalProperties: true
    },
    required_fields: {
      type: "array",
      description: "Field names that must be present in submitted_fields.",
      items: {
        type: "string",
        description: "A required field name."
      }
    },
    source_label: {
      type: "string",
      description: "Optional label identifying the source of the submitted data."
    }
  },
  required: ["submitted_fields", "required_fields", "source_label"],
  additionalProperties: true
} as const;

const outputSchema = {
  type: "object",
  description: "A structured required-fields validation result.",
  properties: {
    status: {
      type: "string",
      description: "Whether the tool completed successfully or returned an error.",
      enum: ["success", "error"]
    },
    is_complete: {
      type: "boolean",
      description: "Whether every required field is present."
    },
    missing_fields: {
      type: "array",
      description: "Required field names absent from submitted_fields.",
      items: { type: "string", description: "A missing field name." }
    },
    present_fields: {
      type: "array",
      description: "Required field names present in submitted_fields.",
      items: { type: "string", description: "A present field name." }
    },
    source_label: {
      type: "string",
      description: "The source label supplied by the caller."
    },
    errors: {
      type: "array",
      description: "Structured errors; empty on successful execution.",
      items: {
        type: "object",
        description: "A structured tool error.",
        properties: {
          code: { type: "string", description: "Stable machine-readable error code." },
          message: { type: "string", description: "Human-readable error message." },
          field: { type: "string", description: "Related input field, or an empty string." }
        },
        required: ["code", "message", "field"],
        additionalProperties: false
      }
    }
  },
  required: [
    "status",
    "is_complete",
    "missing_fields",
    "present_fields",
    "source_label",
    "errors"
  ],
  additionalProperties: false
} as const;

const toolDefinition = {
  name: TOOL_NAME,
  title: "Validate Required Fields",
  description:
    "Checks whether submitted field data contains the required fields and returns a structured validation result. It does not submit forms, approve requests, send messages, or modify external systems.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
} as const;

function buildOutput(
  overrides: Partial<ToolOutput> = {},
  error?: ToolError
): ToolOutput {
  return {
    status: error ? "error" : "success",
    is_complete: false,
    missing_fields: [],
    present_fields: [],
    source_label: "",
    errors: error ? [error] : [],
    ...overrides
  };
}

function buildError(code: ErrorCode, message: string, field = ""): ToolOutput {
  return buildOutput({}, { code, message, field });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const externalActionPattern =
  /\b(submit|approve|send|publish|delete|modify(?:\s+an?)?\s+external\s+system|提交|审批|发送|发布|删除|修改外部系统)\b/i;

function containsOutOfScopeRequest(value: unknown): boolean {
  if (typeof value === "string") return externalActionPattern.test(value);
  if (Array.isArray(value)) return value.some(containsOutOfScopeRequest);
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([key, nested]) =>
        externalActionPattern.test(key.replaceAll("_", " ")) ||
        containsOutOfScopeRequest(nested)
    );
  }
  return false;
}

function validateRequiredFields(argumentsValue: unknown): ToolOutput {
  if (!isRecord(argumentsValue)) {
    return buildError("invalid_input_type", "arguments must be an object.", "arguments");
  }

  if (containsOutOfScopeRequest(argumentsValue)) {
    return buildError(
      "out_of_scope",
      "External actions such as submitting, approving, sending, publishing, deleting, or modifying external systems are out of scope."
    );
  }

  for (const field of ["submitted_fields", "required_fields", "source_label"]) {
    if (!(field in argumentsValue)) {
      return buildError(
        "missing_required_input",
        `Missing required input: ${field}.`,
        field
      );
    }
  }

  const { submitted_fields, required_fields, source_label } = argumentsValue;
  if (!isRecord(submitted_fields)) {
    return buildError(
      "invalid_input_type",
      "submitted_fields must be an object.",
      "submitted_fields"
    );
  }
  if (!Array.isArray(required_fields) || !required_fields.every((item) => typeof item === "string")) {
    return buildError(
      "invalid_input_type",
      "required_fields must be an array of strings.",
      "required_fields"
    );
  }
  if (typeof source_label !== "string") {
    return buildError(
      "invalid_input_type",
      "source_label must be a string.",
      "source_label"
    );
  }
  if (
    Object.keys(submitted_fields).length === 0 &&
    required_fields.length === 0 &&
    source_label === ""
  ) {
    return buildError(
      "empty_input",
      "Input must not be entirely empty.",
      "required_fields"
    );
  }

  const presentFields = required_fields.filter((field) =>
    Object.prototype.hasOwnProperty.call(submitted_fields, field)
  );
  const missingFields = required_fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(submitted_fields, field)
  );

  return buildOutput({
    is_complete: missingFields.length === 0,
    missing_fields: missingFields,
    present_fields: presentFields,
    source_label
  });
}

function toolResult(output: ToolOutput) {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
    isError: output.status === "error"
  };
}

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcToolError(id: unknown, output: ToolOutput): Response {
  return rpcResult(id, toolResult(output));
}

async function handleMcp(request: Request): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcToolError(
      null,
      buildError("invalid_input_type", "Request body must be valid JSON.", "body")
    );
  }

  const id = body.id ?? null;
  try {
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return rpcToolError(
        id,
        buildError(
          "invalid_input_type",
          "A JSON-RPC 2.0 request with a string method is required.",
          "method"
        )
      );
    }

    if (body.method === "initialize") {
      return rpcResult(id, {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "required-fields-validator", version: "1.0.0" },
        capabilities: { tools: {} }
      });
    }

    if (body.method === "tools/list") {
      return rpcResult(id, { tools: [toolDefinition] });
    }

    if (body.method === "tools/call") {
      if (!isRecord(body.params)) {
        return rpcToolError(
          id,
          buildError("missing_required_input", "tools/call params are required.", "params")
        );
      }
      if (body.params.name !== TOOL_NAME) {
        return rpcToolError(
          id,
          buildError(
            "out_of_scope",
            `Unknown tool: ${typeof body.params.name === "string" ? body.params.name : ""}.`,
            "name"
          )
        );
      }
      return rpcResult(id, toolResult(validateRequiredFields(body.params.arguments)));
    }

    return rpcToolError(
      id,
      buildError("out_of_scope", `Unsupported MCP method: ${body.method}.`, "method")
    );
  } catch {
    return rpcToolError(
      id,
      buildError("internal_error", "An internal error occurred while processing the request.")
    );
  }
}

const pageStyles = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; background: #f7f8fb; }
  * { box-sizing: border-box; }
  body { margin: 0; line-height: 1.65; }
  header { background: #172033; color: white; }
  .bar, main, footer { width: min(920px, calc(100% - 40px)); margin: 0 auto; }
  .bar { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .brand { color: white; font-weight: 750; text-decoration: none; }
  nav { display: flex; flex-wrap: wrap; gap: 18px; }
  nav a { color: #dce6ff; text-decoration: none; }
  nav a:hover, nav a:focus { color: white; text-decoration: underline; }
  main { padding: 56px 0 64px; }
  h1 { margin: 0 0 12px; font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1.12; }
  h2 { margin-top: 38px; line-height: 1.25; }
  .lede { font-size: 1.2rem; color: #4a5872; max-width: 720px; }
  .card { background: white; border: 1px solid #dfe4ee; border-radius: 14px; padding: 24px; margin: 22px 0; box-shadow: 0 8px 24px rgb(23 32 51 / 5%); }
  code { background: #edf1f7; border-radius: 5px; padding: 2px 6px; }
  a { color: #1557b0; }
  footer { border-top: 1px solid #dfe4ee; padding: 24px 0 40px; color: #5c667a; }
  @media (max-width: 680px) { .bar { align-items: flex-start; flex-direction: column; padding: 18px 0; } main { padding-top: 38px; } }
`;

function renderPage(title: string, content: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${USE_CASE}">
  <title>${title} | ${APP_NAME}</title>
  <style>${pageStyles}</style>
</head>
<body>
  <header>
    <div class="bar">
      <a class="brand" href="/">${APP_NAME}</a>
      <nav aria-label="Primary navigation">
        <a href="/">Home</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/support">Support</a>
      </nav>
    </div>
  </header>
  <main>${content}</main>
  <footer>${APP_NAME} · <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></footer>
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=UTF-8" }
  });
}

function homePage(): Response {
  return renderPage(
    "Home",
    `<h1>${APP_NAME}</h1>
    <p class="lede">${USE_CASE}</p>
    <section class="card">
      <h2>What this app does</h2>
      <p>It compares submitted field data with a caller-provided list of required field names and returns a deterministic, structured validation result.</p>
      <h2>When ChatGPT should use it</h2>
      <p>ChatGPT should use this app when it needs to check whether a set of submitted fields contains every required field name.</p>
      <h2>What input it accepts</h2>
      <p>The tool accepts <code>submitted_fields</code> as an object, <code>required_fields</code> as an array of strings, and <code>source_label</code> as a string.</p>
      <h2>What output it returns</h2>
      <p>It returns structured content containing status, completeness, missing fields, present fields, the source label, and structured errors.</p>
    </section>
    <section class="card">
      <h2>Available tools</h2>
      <p><code>validate_required_fields</code> — validates the presence of required field names.</p>
      <h2>MCP endpoint</h2>
      <p><code>POST /mcp</code></p>
    </section>
    <section class="card">
      <h2>What this app does NOT do</h2>
      <p>It does not submit forms, approve requests, send or publish messages, delete data, modify external systems, make decisions, or provide professional advice.</p>
      <h2>Data handling</h2>
      <p>Input is processed only to generate the validation result. This app has no database, account system, external API client, or persistent storage.</p>
      <h2>Support</h2>
      <p>For assistance, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> or visit the <a href="/support">Support page</a>.</p>
    </section>`
  );
}

function privacyPage(): Response {
  return renderPage(
    "Privacy",
    `<h1>Privacy</h1>
    <p class="lede">${APP_NAME}: ${USE_CASE}</p>
    <section class="card">
      <h2>Data collected</h2>
      <p>The app receives only the submitted fields, required field names, source label, and MCP request metadata supplied with a request. It does not request account credentials or identity documents.</p>
      <h2>How input is used</h2>
      <p>Input is used solely to compare required field names with the keys present in submitted field data.</p>
      <h2>How output is generated</h2>
      <p>Output is generated deterministically from field-presence checks and runtime input validation.</p>
      <h2>Retention</h2>
      <p>The app does not store request input or validation output in a database or application-managed persistent storage.</p>
      <h2>External sharing</h2>
      <p>The app does not intentionally share request input or output with third parties.</p>
      <h2>External API policy</h2>
      <p>No external API is called to perform validation.</p>
      <h2>Account/login policy</h2>
      <p>No account, login, or OAuth connection is required or supported.</p>
      <h2>User controls</h2>
      <p>Users control which field data, required field names, and source label they provide. Avoid submitting data that is unnecessary for field-presence validation.</p>
      <h2>Read-only boundary</h2>
      <p>The app is read-only with respect to external systems. It cannot submit, approve, send, publish, delete, or modify external records.</p>
      <h2>Contact</h2>
      <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <h2>Last updated</h2>
      <p>July 9, 2026</p>
    </section>`
  );
}

function termsPage(): Response {
  return renderPage(
    "Terms",
    `<h1>Terms</h1>
    <p class="lede">${APP_NAME}: ${USE_CASE}</p>
    <section class="card">
      <h2>Service description</h2>
      <p>The service checks whether submitted field data contains caller-specified required field names and returns a structured result.</p>
      <h2>Allowed use</h2>
      <p>You may use the service for lawful field-presence validation within its documented input and output contract.</p>
      <h2>User responsibility</h2>
      <p>You are responsible for the accuracy, lawfulness, and appropriateness of data you provide and for reviewing output before relying on it.</p>
      <h2>Limitations</h2>
      <p>The service checks field-name presence only. It does not verify truth, semantic accuracy, identity, authorization, or suitability of field values.</p>
      <h2>No external execution</h2>
      <p>The service does not submit forms, approve requests, send messages, publish content, or modify external systems.</p>
      <h2>No professional advice unless scoped</h2>
      <p>The service does not provide legal, financial, medical, compliance, or other professional advice.</p>
      <h2>No destructive actions</h2>
      <p>The service does not delete data or perform destructive operations.</p>
      <h2>No guarantees</h2>
      <p>The service is provided as available without guarantees of uninterrupted operation or fitness for a particular purpose.</p>
      <h2>Prohibited use</h2>
      <p>You may not use the service unlawfully, to probe or disrupt systems, to bypass access controls, or to misrepresent its output as a decision or approval.</p>
      <h2>Changes to service</h2>
      <p>These terms and the service may be updated to maintain security, accuracy, or operational requirements.</p>
      <h2>Contact</h2>
      <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <h2>Last updated</h2>
      <p>July 9, 2026</p>
    </section>`
  );
}

function supportPage(): Response {
  return renderPage(
    "Support",
    `<h1>Support</h1>
    <p class="lede">Support for ${APP_NAME}: ${USE_CASE}</p>
    <section class="card">
      <h2>Support email</h2>
      <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <h2>What to provide when contacting support</h2>
      <p>Please include a concise issue description, the route or tool used, the approximate time of the request, the expected result, and the actual error code or response. Remove sensitive or unnecessary field values.</p>
      <h2>Support scope</h2>
      <p>Support covers access to the documented pages and MCP endpoint, input and output contract questions, and reproducible validation errors.</p>
      <h2>Non-support scope</h2>
      <p>Support does not submit forms, approve requests, recover third-party accounts, alter external records, provide professional advice, or build unrelated integrations.</p>
      <h2>Data/privacy questions</h2>
      <p>Send privacy and data-handling questions to the support email and identify the request as a privacy question.</p>
      <h2>App boundary reminder</h2>
      <p>This app only checks whether submitted field data includes required field names. It is read-only and performs no external actions.</p>
    </section>`
  );
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return homePage();
    }
    if (request.method === "GET" && url.pathname === "/privacy") {
      return privacyPage();
    }
    if (request.method === "GET" && url.pathname === "/terms") {
      return termsPage();
    }
    if (request.method === "GET" && url.pathname === "/support") {
      return supportPage();
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/openai-apps-challenge"
    ) {
      if (typeof env.OPENAI_APPS_CHALLENGE !== "string") {
        return new Response("Challenge is not configured.", { status: 503 });
      }
      return new Response(env.OPENAI_APPS_CHALLENGE, {
        headers: { "content-type": "text/plain; charset=UTF-8" }
      });
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      return handleMcp(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};
