import api, { route } from "@forge/api";
import {
  buildSearchJql,
  clampLimit,
  extractDecisions,
  summarizeChange,
  rankOwners,
  groupBlockers,
  draftStatusUpdate,
  escapeJqlValue,
} from "./lib/context.js";

const FIELDS = ["summary", "status", "assignee", "updated", "priority", "labels", "comment", "issuelinks"];

async function searchIssues(jql, maxResults) {
  // asUser keeps every read inside the caller's existing Jira permissions.
  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jql, maxResults, fields: FIELDS }),
  });

  if (!response.ok) {
    throw new Error(`Jira search failed with ${response.status}. Check the query and the caller's permissions.`);
  }

  const body = await response.json();
  return body.issues || [];
}

function areaClause(projectKey) {
  return projectKey ? `project = "${escapeJqlValue(projectKey)}" AND ` : "";
}

function formatDecisions(results) {
  if (!results.length) {
    return "No decision comments found. Try a broader topic, or drop the project filter.";
  }

  const lines = [];
  for (const issue of results) {
    lines.push(`${issue.key} — ${issue.summary} [${issue.status}]`);
    for (const decision of issue.decisions) {
      lines.push(`  • "${decision.quote}"`);
      lines.push(`    ${decision.author}, ${formatDate(decision.created)} — ${decision.url}`);
    }
  }
  return lines.join("\n");
}

function formatDate(value) {
  const parsed = Date.parse(value || 0);
  return parsed ? new Date(parsed).toISOString().slice(0, 10) : "unknown date";
}

export async function findDecisions(payload = {}) {
  const { query, projectKey, limit } = payload;
  if (!query) return "I need a topic to search for.";

  try {
    const { jql, maxResults } = buildSearchJql({ text: query, projectKey, limit });
    const issues = await searchIssues(jql, maxResults);
    return formatDecisions(extractDecisions(issues));
  } catch (error) {
    return error.message;
  }
}

export async function explainIssue(payload = {}) {
  const { issueKey } = payload;
  if (!issueKey) return "I need a Jira issue key such as TEAM-123.";

  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,status,assignee,updated,priority,labels,comment,issuelinks`);

  if (!response.ok) {
    return `Could not read ${issueKey} (status ${response.status}). Check the key and your permissions.`;
  }

  const summary = summarizeChange(await response.json());
  if (!summary) return `Could not summarise ${issueKey}.`;

  const lines = [
    `${summary.key} — ${summary.summary}`,
    `Status: ${summary.status} | Assignee: ${summary.assignee} | Updated: ${formatDate(summary.updated)}`,
    summary.labels.length ? `Labels: ${summary.labels.join(", ")}` : null,
    summary.url,
  ].filter(Boolean);

  if (summary.decisions.length) {
    lines.push("", "Why it looks like this:");
    for (const decision of summary.decisions) {
      lines.push(`  • "${decision.quote}" — ${decision.author}, ${formatDate(decision.created)}`);
    }
  } else {
    lines.push("", "No decision comments recorded on this issue.");
  }

  return lines.join("\n");
}

export async function whoOwns(payload = {}) {
  const { query, projectKey } = payload;
  if (!query) return "I need an area to look for, for example 'payments'.";

  try {
    const { jql, maxResults } = buildSearchJql({ text: query, projectKey, limit: 50 });
    const ranked = rankOwners(await searchIssues(jql, maxResults));
    if (!ranked.length) return "No assigned issues matched, so there is no clear owner yet.";

    return [
      `Most likely owners for "${query}":`,
      ...ranked.slice(0, 5).map(
        (owner, index) =>
          `${index + 1}. ${owner.displayName} — ${owner.issueCount} issue(s), last active ${formatDate(owner.lastActive)}`
      ),
    ].join("\n");
  } catch (error) {
    return error.message;
  }
}

export async function blockedWork(payload = {}) {
  const { projectKey } = payload;
  const jql = `${areaClause(projectKey)}statusCategory != Done ORDER BY priority DESC`;

  try {
    const groups = groupBlockers(await searchIssues(jql, 50));
    if (!groups.length) return "Nothing is currently blocked by a linked issue.";

    const lines = ["Blocked work, grouped by the blocker's status:"];
    for (const group of groups) {
      lines.push("", `${group.reason} (${group.blocked.length})`);
      for (const item of group.blocked) {
        lines.push(`  • ${item.key} ${item.summary} — blocked by ${item.blockedBy} (${item.blockerSummary}) — ${item.assignee}`);
      }
    }
    return lines.join("\n");
  } catch (error) {
    return error.message;
  }
}

export async function draftStatusUpdateTool(payload = {}) {
  const { projectKey } = payload;
  const days = Math.min(60, Math.max(1, Number(payload.sinceDays) || 7));
  const jql = `${areaClause(projectKey)}updated >= -${days}d ORDER BY updated DESC`;

  try {
    const update = draftStatusUpdate(await searchIssues(jql, clampLimit(50)));
    return [
      `Draft status update (last ${days} days, ${update.totalIssues} issue(s)). Edit before sending:`,
      "",
      update.plainText,
    ].join("\n");
  } catch (error) {
    return error.message;
  }
}
