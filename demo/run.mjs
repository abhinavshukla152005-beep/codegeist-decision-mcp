import { writeFileSync } from "node:fs";
import {
  findDecisions,
  explainIssue,
  whoOwns,
  blockedWork,
  draftStatusUpdateTool,
} from "../src/index.js";

const calls = [
  { tool: "find-decisions", args: { query: "session tokens", projectKey: "CLSD" }, fn: findDecisions },
  { tool: "explain-issue", args: { issueKey: "CLSD-9" }, fn: explainIssue },
  { tool: "who-owns", args: { query: "beta", projectKey: "CLSD" }, fn: whoOwns },
  { tool: "blocked-work", args: { projectKey: "CLSD" }, fn: blockedWork },
  {
    tool: "draft-status-update",
    args: { projectKey: "CLSD", sinceDays: 7 },
    fn: draftStatusUpdateTool,
  },
];

const results = [];
for (const call of calls) {
  const output = await call.fn(call.args);
  results.push({ tool: call.tool, args: call.args, output });
  console.log(`\n=== ${call.tool} ${JSON.stringify(call.args)} ===`);
  console.log(output);
}

writeFileSync(new URL("./output.json", import.meta.url), JSON.stringify(results, null, 2));
