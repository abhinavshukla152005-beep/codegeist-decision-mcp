# Decision Keeper — Rovo MCP tools for "why did this change?"

Codegeist 2026 entry. A Forge app that exposes five read-only MCP tools so any
MCP-compatible AI client (Claude, Cursor, Rovo Studio agents) can answer
questions about a team's Jira work with cited evidence instead of guesses.

Targets **Best app with Atlassian MCP** ($1,500, 6 winners) and **Best
Agents — Rovo/Assignable agents** ($1,500, 6 winners), plus the 300-entry
participation prize.

## Why this exists

Every agent can summarise a ticket. Almost none can answer *"why is it like
this?"* — the answer is buried in comment threads, and an agent that invents
it is worse than no agent. This app turns Jira's own decision history into a
tool an agent can cite.

## Tools

| Tool | Question it answers |
| --- | --- |
| `find-decisions` | "What did we decide about billing queues, and who said it?" |
| `explain-issue` | "Why is TEAM-123 in this state?" |
| `who-owns` | "Who actually owns payments right now?" |
| `blocked-work` | "What is blocked, by what, and who do I chase?" |
| `draft-status-update` | "Draft this week's update from what actually moved." |

All five are read-only and run as the invoking user (`api.asUser()`), so no
tool can read anything the caller cannot already see in Jira. There is no
write path and no stored copy of customer data.

## How it works

`src/lib/context.js` is pure logic with no Forge dependency:

- JQL is built with escaped values, so a topic like `x" OR project = "OTHER`
  stays a single quoted search term (`test/context.test.js` asserts this).
- Decision detection looks for agreement/rejection/trade-off language in
  comment bodies and returns the quote, author, date and comment permalink.
- Owner ranking weights assignment recency, so a stale assignee loses to
  someone who touched the area last week.
- Blockers are grouped by the blocking issue's status, not just listed.

`src/index.js` wires those functions to the Jira REST API. It is thin on
purpose: permissions, HTTP and formatting only.

## Verification

```bash
npm test        # 18 tests, no network or Atlassian account needed
```

## Try it in three minutes

1. Open the installation link, pick a Jira site, approve:
   <https://developer.atlassian.com/console/install/e58af217-8e82-4345-89ba-24ab5d85cc45>
2. App id: `ari:cloud:ecosystem::app/e58af217-8e82-4345-89ba-24ab5d85cc45`.
3. In Rovo Studio create a custom agent and add these five tools — or point any
   MCP client at `https://mcp.atlassian.com/forge/e58af217-8e82-4345-89ba-24ab5d85cc45`
   (an org admin has to enable external MCP access first).
4. Ask it: "What did we decide about <a topic from your own Jira>?"

A two-minute demo run against a real Jira site: <https://youtu.be/onhw2H3oJUQ>

## Deploy your own copy

```bash
npm install -g @forge/cli@latest
forge login                     # opens the browser, sign in, approve
cd codegeist-decision-mcp
forge register                  # prompts for a name, writes the real app id
forge install --site <your-site>.atlassian.net --product jira
forge deploy
```

## Judging map

| Criterion | Where it shows up |
| --- | --- |
| Technological implementation | Real Jira REST calls, `api.asUser()` scoping, 18 passing tests over the pure logic |
| Design | Five narrow tools with plain-language descriptions agents can pick correctly |
| Potential impact | Answers the question every engineering org asks daily |
| Innovation | Decision archaeology + citations, not another summariser |
| Presentation | The demo is a question with a surprising answer |
