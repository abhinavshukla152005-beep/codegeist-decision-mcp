const DECISION_PATTERNS = [
  /\bwe (decided|chose|agreed|rejected|will go with)\b/i,
  /\bdecision\b/i,
  /\bbecause of\b/i,
  /\btrade-?off\b/i,
  /\binstead of\b/i,
];

export function escapeJqlValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildSearchJql({ text, projectKey, limit = 20 }) {
  const clauses = [];

  if (projectKey) clauses.push(`project = "${escapeJqlValue(projectKey)}"`);

  if (text) {
    const safe = escapeJqlValue(text);
    clauses.push(`(summary ~ "${safe}" OR description ~ "${safe}" OR comment ~ "${safe}")`);
  }

  const jql = (clauses.length ? clauses.join(" AND ") + " " : "") + "ORDER BY updated DESC";
  return { jql, maxResults: clampLimit(limit) };
}

export function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

export function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join(" ");
  const parts = [];
  if (node.type === "text" && node.text) parts.push(node.text);
  if (node.content) parts.push(adfToText(node.content));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function looksLikeDecision(text) {
  if (!text) return false;
  return DECISION_PATTERNS.some((p) => p.test(text));
}

export function extractDecisions(issues, { maxPerIssue = 3 } = {}) {
  const results = [];

  for (const issue of issues || []) {
    const key = issue?.key;
    if (!key) continue;

    const decisions = [];
    for (const comment of issue?.fields?.comment?.comments || []) {
      const body = adfToText(comment?.body);
      if (!looksLikeDecision(body)) continue;
      decisions.push({
        key,
        quote: truncate(body, 400),
        author: comment?.author?.displayName || "unknown",
        created: comment?.created || null,
        url: absoluteUrl(issue?.self, key, comment?.id),
      });
      if (decisions.length >= maxPerIssue) break;
    }

    if (decisions.length) {
      results.push({
        key,
        summary: issue?.fields?.summary || "",
        status: issue?.fields?.status?.name || "unknown",
        decisions,
      });
    }
  }

  return results.sort((a, b) => latest(b) - latest(a));
}

function latest(entry) {
  return Math.max(...entry.decisions.map((d) => Date.parse(d.created || 0) || 0), 0);
}

export function absoluteUrl(self, key, commentId) {
  const base = typeof self === "string" ? self.split("/rest/")[0] : "";
  if (!base || !key) return "";
  return commentId ? `${base}/browse/${key}?focusedCommentId=${commentId}` : `${base}/browse/${key}`;
}

export function truncate(text, max) {
  const s = String(text || "").trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

export function summarizeChange(issue) {
  if (!issue?.key) return null;
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || "",
    status: f.status?.name || "unknown",
    assignee: f.assignee?.displayName || "Unassigned",
    priority: f.priority?.name || null,
    updated: f.updated || null,
    labels: f.labels || [],
    decisions: extractDecisions([issue], { maxPerIssue: 5 })[0]?.decisions || [],
    url: absoluteUrl(issue.self, issue.key),
  };
}

export function rankOwners(issues, { now = Date.now() } = {}) {
  const scores = new Map();

  for (const issue of issues || []) {
    const assignee = issue?.fields?.assignee;
    if (!assignee?.accountId) continue;

    const updated = Date.parse(issue?.fields?.updated || 0) || 0;
    const ageDays = Math.max(0, (now - updated) / 86_400_000);
    const recency = 1 / (1 + ageDays / 30);

    const current = scores.get(assignee.accountId) || {
      accountId: assignee.accountId,
      displayName: assignee.displayName || "unknown",
      score: 0,
      issueCount: 0,
      lastActive: null,
    };

    current.score += recency;
    current.issueCount += 1;
    if (!current.lastActive || updated > Date.parse(current.lastActive)) {
      current.lastActive = updated ? new Date(updated).toISOString() : current.lastActive;
    }

    scores.set(assignee.accountId, current);
  }

  return [...scores.values()]
    .map((o) => ({ ...o, score: Math.round(o.score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || b.issueCount - a.issueCount);
}

export function groupBlockers(issues) {
  const groups = new Map();

  for (const issue of issues || []) {
    const links = issue?.fields?.issuelinks || [];
    const blockers = links.filter((l) => /is blocked by/i.test(l?.type?.inward || ""));
    if (!blockers.length) continue;

    for (const link of blockers) {
      const blocker = link.inwardIssue || link.outwardIssue;
      if (!blocker?.key) continue;

      const reason = blocker?.fields?.status?.name || "unknown status";
      const bucket = groups.get(reason) || { reason, blocked: [] };
      bucket.blocked.push({
        key: issue.key,
        summary: issue.fields?.summary || "",
        blockedBy: blocker.key,
        blockerSummary: blocker.fields?.summary || "",
        assignee: issue.fields?.assignee?.displayName || "Unassigned",
      });
      groups.set(reason, bucket);
    }
  }

  return [...groups.values()].sort((a, b) => b.blocked.length - a.blocked.length);
}

export function draftStatusUpdate(issues, { since = null } = {}) {
  const cutoff = since ? Date.parse(since) : 0;
  const relevant = (issues || []).filter((i) => (Date.parse(i?.fields?.updated || 0) || 0) >= cutoff);

  const byStatus = new Map();
  for (const issue of relevant) {
    const status = issue.fields?.status?.name || "unknown";
    const bucket = byStatus.get(status) || [];
    bucket.push(`- ${issue.key}: ${issue.fields?.summary || ""} (${issue.fields?.assignee?.displayName || "Unassigned"})`);
    byStatus.set(status, bucket);
  }

  const sections = [...byStatus.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([status, lines]) => ({ status, count: lines.length, lines }));

  return {
    totalIssues: relevant.length,
    sections,
    plainText: sections.length
      ? sections.map((s) => `${s.status} (${s.count})\n${s.lines.join("\n")}`).join("\n\n")
      : "No issue activity in the selected window.",
  };
}
