// api/state.js
export default async function handler(req, res) {
  // Limit CORS to your Pages origin for security:
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    GH_TOKEN, GH_OWNER, GH_REPO,
    GH_BRANCH = 'main',
    GH_DIR = 'data'
  } = process.env;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({ error: 'Missing GH_* env vars' });
  }

  const urlBase = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents`;

  async function githubFetch(url, init={}) {
    const r = await fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'User-Agent': 'vac-tracker',
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });
    return r;
  }

  async function getFileSha(path) {
    const r = await githubFetch(`${urlBase}/${encodeURIComponent(path)}?ref=${encodeURIComponent(GH_BRANCH)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GET sha failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    return j.sha;
  }

  async function readFile(path) {
    const r = await githubFetch(`${urlBase}/${encodeURIComponent(path)}?ref=${encodeURIComponent(GH_BRANCH)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GET file failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    const content = Buffer.from(j.content, 'base64').toString('utf8');
    return { json: JSON.parse(content), sha: j.sha };
  }

  async function writeFile(path, json, message, sha = null) {
    const body = {
      message,
      branch: GH_BRANCH,
      content: Buffer.from(JSON.stringify(json, null, 2), 'utf8').toString('base64'),
      ...(sha ? { sha } : {})
    };
    const r = await githubFetch(`${urlBase}/${encodeURIComponent(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`PUT failed: ${r.status} ${await r.text()}`);
    return r.json();
  }

  try {
    const { searchParams } = new URL(req.url, 'http://localhost');
    const key = searchParams.get('key') || 'state';
    const path = `${GH_DIR}/${key}.json`;

    if (req.method === 'GET') {
      const file = await readFile(path);
      return res.status(200).json({ found: !!file, data: file?.json ?? null, sha: file?.sha ?? null });
    }

    if (req.method === 'POST') {
      const body = await (async () => { try { return await req.json(); } catch { return null; }})();
      if (!body) return res.status(400).json({ error: 'No JSON body' });
      const payload = body.data || body;
      const sha = await getFileSha(path);
      const result = await writeFile(path, payload, body.commitMessage || `Update ${key}.json`, sha || undefined);
      return res.status(200).json({ ok: true, path, commit: result?.commit?.sha });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
