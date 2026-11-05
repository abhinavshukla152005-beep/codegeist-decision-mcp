import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchJql,
  clampLimit,
  escapeJqlValue,
  adfToText,
  looksLikeDecision,
  extractDecisions,
  summarizeChange,
  rankOwners,
  groupBlockers,
  draftStatusUpdate,
} from "../src/lib/context.js";

const comment = (text, author = "Asha", created = "2026-11-01T10:00:00.000Z") => ({
  id: "10001",
  author: { displayName: author },
  created,
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
});

const issue = (overrides = {}) => ({
  key: "TEAM-1",
  self: "https://acme.atlassian.net/rest/api/3/issue/10001",
  fields: {
    summary: "Move billing to event queue",
    status: { name: "In Progress" },
    assignee: { accountId: "acc-1", displayName: "Ravi" },
    updated: "2026-11-04T09:00:00.000Z",
    comment: { comments: [] },
    issuelinks: [],
    labels: [],
    ...overrides,
  },
});

test("escapeJqlValue escapes quotes and backslashes", () => {
  assert.equal(escapeJqlValue('say "hi"'), 'say \\"hi\\"');
  assert.equal(escapeJqlValue("a\\b"), "a\\\\b");
});

test("buildSearchJql quotes text and keeps ordering", () => {
  const { jql, maxResults } = buildSearchJql({ text: "billing", projectKey: "TEAM", limit: 5 });
  assert.match(jql, /project = "TEAM"/);
  assert.match(jql, /summary ~ "billing"/);
  assert.match(jql, /ORDER BY updated DESC$/);
  assert.equal(maxResults, 5);
});

test("buildSearchJql survives injection-style input", () => {
  const { jql } = buildSearchJql({ text: 'x" OR project = "OTHER' });
  assert.ok(jql.includes('summary ~ "x\\" OR project = \\"OTHER"'));
  const unescapedQuotes = (jql.replace(/\\"/g, "").match(/"/g) || []).length;
  assert.equal(unescapedQuotes, 6);
  assert.equal((jql.match(/~ "/g) || []).length, 3);
});

test("clampLimit keeps values inside 1..50", () => {
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(999), 50);
  assert.equal(clampLimit("abc"), 20);
});

test("adfToText flattens nested document nodes", () => {
  const body = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "We decided" }, { type: "text", text: "to queue it." }] },
    ],
  };
  assert.equal(adfToText(body), "We decided to queue it.");
});

test("looksLikeDecision matches decision language only", () => {
  assert.equal(looksLikeDecision("We decided to use a queue because of spikes."), true);
  assert.equal(looksLikeDecision("Trade-off: latency vs durability"), true);
  assert.equal(looksLikeDecision("Deployed to staging."), false);
});

test("extractDecisions keeps only decision comments and caps per issue", () => {
  const withDecisions = issue({
    comment: {
      comments: [
        comment("Deployed to staging."),
        comment("We agreed to move billing to an event queue instead of polling."),
        comment("Because of the 10k/min spike we rejected the cron job."),
        comment("Decision: keep the old endpoint for two sprints."),
        comment("We chose Postgres advisory locks."),
      ],
    },
  });

  const result = extractDecisions([withDecisions], { maxPerIssue: 2 });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, "TEAM-1");
  assert.equal(result[0].decisions.length, 2);
  assert.match(result[0].decisions[0].url, /acme\.atlassian\.net\/browse\/TEAM-1/);
});

test("extractDecisions drops issues with no decision comments", () => {
  const plain = issue({ comment: { comments: [comment("Deployed to staging.")] } });
  assert.deepEqual(extractDecisions([plain]), []);
});

test("extractDecisions tolerates malformed issues", () => {
  assert.deepEqual(extractDecisions([null, {}, { key: "X" }]), []);
});

test("summarizeChange returns a flat, citeable view", () => {
  const summary = summarizeChange(
    issue({ comment: { comments: [comment("We decided to ship behind a flag.")] } })
  );
  assert.equal(summary.key, "TEAM-1");
  assert.equal(summary.status, "In Progress");
  assert.equal(summary.assignee, "Ravi");
  assert.equal(summary.decisions.length, 1);
  assert.match(summary.url, /browse\/TEAM-1$/);
});

test("summarizeChange returns null without a key", () => {
  assert.equal(summarizeChange({}), null);
});

test("rankOwners weights recent activity above older activity", () => {
  const now = Date.parse("2026-11-05T00:00:00.000Z");
  const recent = issue({ assignee: { accountId: "acc-new", displayName: "New" }, updated: "2026-11-04T00:00:00.000Z" });
  const old = issue({ assignee: { accountId: "acc-old", displayName: "Old" }, updated: "2026-08-01T00:00:00.000Z" });

  const ranked = rankOwners([old, old, recent], { now });
  assert.equal(ranked[0].accountId, "acc-new");
  assert.equal(ranked[1].issueCount, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("rankOwners skips unassigned issues", () => {
  assert.deepEqual(rankOwners([issue({ assignee: null })]), []);
});

test("groupBlockers buckets by blocker status", () => {
  const blockedByReview = issue({
    key: "TEAM-2",
    issuelinks: [
      {
        type: { inward: "is blocked by" },
        inwardIssue: { key: "TEAM-9", fields: { summary: "Security review", status: { name: "Waiting" } } },
      },
    ],
  });
  const blockedByReview2 = issue({
    key: "TEAM-3",
    issuelinks: [
      {
        type: { inward: "is blocked by" },
        inwardIssue: { key: "TEAM-10", fields: { summary: "Vendor contract", status: { name: "Waiting" } } },
      },
    ],
  });

  const groups = groupBlockers([blockedByReview, blockedByReview2]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, "Waiting");
  assert.equal(groups[0].blocked.length, 2);
});

test("groupBlockers ignores the blocking side of a Blocks link", () => {
  const blocker = issue({
    key: "TEAM-1",
    issuelinks: [
      {
        type: { outward: "blocks", inward: "is blocked by" },
        outwardIssue: { key: "TEAM-2", fields: { summary: "Beta launch", status: { name: "Open" } } },
      },
    ],
  });
  assert.deepEqual(groupBlockers([blocker]), []);
});

test("groupBlockers ignores non-blocking links", () => {
  const relates = issue({
    issuelinks: [{ type: { outward: "relates to" }, outwardIssue: { key: "TEAM-4", fields: {} } }],
  });
  assert.deepEqual(groupBlockers([relates]), []);
});

test("draftStatusUpdate groups by status and honours the since cutoff", () => {
  const fresh = issue({ updated: "2026-11-04T00:00:00.000Z" });
  const stale = issue({ key: "TEAM-7", updated: "2026-09-01T00:00:00.000Z", fields: { ...issue().fields, status: { name: "Done" } } });

  const update = draftStatusUpdate([fresh, stale], { since: "2026-10-01T00:00:00.000Z" });
  assert.equal(update.totalIssues, 1);
  assert.equal(update.sections[0].status, "In Progress");
  assert.match(update.plainText, /TEAM-1/);
  assert.doesNotMatch(update.plainText, /TEAM-7/);
});

test("draftStatusUpdate handles empty input", () => {
  const update = draftStatusUpdate([]);
  assert.equal(update.totalIssues, 0);
  assert.match(update.plainText, /No issue activity/);
});
