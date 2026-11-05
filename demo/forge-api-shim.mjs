const BASE = process.env.JIRA_BASE || "https://one-atlas-dvyb.atlassian.net";
const AUTH =
  "Basic " +
  Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_TOKEN}`).toString("base64");

export function route(strings, ...values) {
  return strings.reduce((acc, part, i) => acc + part + (i < values.length ? values[i] : ""), "");
}

async function requestJira(path, options = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: AUTH },
  });
}

export default { asUser: () => ({ requestJira }) };
