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

## Local verification

```bash
npm test        # 17 tests, no network or Atlassian account needed
```

`forge lint` validates the manifest (the only expected error before
registration is the `<your app id>` placeholder).

## Deploy (needs your Atlassian account — one time)

```bash
npm install -g @forge/cli@latest
forge login                     # opens the browser, sign in, approve
cd codegeist-decision-mcp
forge register                  # prompts for a name, writes the real app id
forge install --site <your-site>.atlassian.net --product jira
forge deploy
```

Then in Rovo Studio: create a custom agent, add these five tools, and ask it
"what did we decide about <topic>?". For third-party clients, the MCP
endpoint is `https://mcp.atlassian.com/forge/<appId>` — an org admin must
enable external MCP access first.

## Submission checklist (deadline 22 Dec 2026, 3:00pm EST)

- [ ] Deploy, then paste an **installation link** for judges (Forge → Start sharing your app).
- [ ] Demo video under 5 minutes, public on YouTube. Must show a real Jira comment being found and cited, not a mock.
- [ ] Submit to the **Atlassian MCP** bonus category and the **Rovo agents** bonus category.
- [ ] If time allows, publish to Marketplace — that unlocks the fourth bonus category.
- [ ] Submit early: the 300 participation prizes are first-come-first-served.

## Judging map

| Criterion | Where it shows up |
| --- | --- |
| Technological implementation | Real Jira API calls, `asUser` scoping, 17 passing tests |
| Design | Five narrow tools with plain-language descriptions agents can pick correctly |
| Potential impact | Answers the question every engineering org asks daily |
| Innovation | Decision archaeology + citations, not another summariser |
| Presentation | The demo is a question with a surprising answer |
