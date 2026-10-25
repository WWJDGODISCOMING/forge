// Minimal Withings Health Data API client (public "Start for Free" plan). `fetch` is injected so tests
// run with no network. Every call returns the parsed `body`, or throws a WithingsError with the status.
// Never logs or returns tokens in errors.

export const API = 'https://wbsapi.withings.net';
export const AUTHORIZE = 'https://account.withings.com/oauth2_user/authorize2';

// Withings status codes we act on (others are treated as permanent failures).
export const INVALID_TOKEN = new Set([100, 101, 102, 200, 283, 401, 343]);
export const RATE_LIMIT = 601;
export const SCOPE = 'user.info,user.metrics,user.activity';
export const APPLI_ACTIVITY = 16;
export const TIMEOUT = 522; // Withings' own "timeout": try again later

export class WithingsError extends Error {
  /** status: Withings' JSON `status`, or a string for HTTP/network problems ('http_503', 'network'…). */
  constructor(status, where) {
    super(`Withings ${where}: status ${status}`);
    this.status = status;
    this.where = where;
  }
  /** Worth retrying later: rate limit, HTTP 5xx/429, timeouts, network trouble, our own save hiccups. */
  get transient() {
    return this.status === RATE_LIMIT || this.status === TIMEOUT || ['network', 'save_failed', 'lease_timeout', 'bad_json', 'http_429'].includes(this.status)
      || (typeof this.status === 'string' && /^http_5\d\d$/.test(this.status));
  }
  get invalidToken() {
    return INVALID_TOKEN.has(this.status);
  }
}

export function makeClient({ fetch, clientId, clientSecret, timeoutMs = 7000 }) {
  async function post(path, params, token, where) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) body.set(k, String(v));
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WithingsError('network', where);
    }
    if (!res.ok) throw new WithingsError(`http_${res.status}`, where);
    let json;
    try {
      json = await res.json();
    } catch {
      throw new WithingsError('bad_json', where);
    }
    if (json.status !== 0) throw new WithingsError(json.status, where);
    return json.body || {};
  }

  return {
    authorizeUrl({ redirectUri, state, scope = SCOPE }) {
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope, redirect_uri: redirectUri, state });
      return `${AUTHORIZE}?${q}`;
    },
    /** Authorization code → { userid, access_token, refresh_token, expires_in, scope }. The code dies in 30 s. */
    requestToken({ code, redirectUri }) {
      return post('/v2/oauth2', { action: 'requesttoken', grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }, null, 'requesttoken');
    },
    /** Rotates the refresh token: the old one keeps working for 8 hours. */
    refreshToken(refreshToken) {
      return post('/v2/oauth2', { action: 'requesttoken', grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }, null, 'refresh');
    },
    /** One page of measure groups. Pass lastupdate (incremental) or startdate/enddate, plus offset. */
    getmeas(token, { meastypes, lastupdate, startdate, enddate, offset } = {}) {
      return post('/measure', { action: 'getmeas', meastypes: meastypes ? meastypes.join(',') : null, category: 1, lastupdate, startdate, enddate, offset }, token, 'getmeas');
    },
    /** Daily activity (steps) for startdateymd..enddateymd (YYYY-MM-DD, inclusive). Needs the user.activity scope. */
    getactivity(token, { startdateymd, enddateymd, offset } = {}) {
      return post('/v2/measure', { action: 'getactivity', startdateymd, enddateymd, data_fields: 'steps', offset }, token, 'getactivity');
    },
    getdevice(token) {
      return post('/v2/user', { action: 'getdevice' }, token, 'getdevice');
    },
    notifySubscribe(token, callbackurl, appli = 1) {
      return post('/notify', { action: 'subscribe', callbackurl, appli }, token, 'notify_subscribe');
    },
    notifyList(token, appli = 1) {
      return post('/notify', { action: 'list', appli }, token, 'notify_list');
    },
    notifyRevoke(token, callbackurl, appli = 1) {
      return post('/notify', { action: 'revoke', callbackurl, appli }, token, 'notify_revoke');
    },
  };
}

/** Firestore error codes worth a retry: ABORTED, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, INTERNAL, UNAVAILABLE. */
const FS_TRANSIENT = new Set([4, 8, 10, 13, 14, 'aborted', 'deadline-exceeded', 'resource-exhausted', 'internal', 'unavailable']);
export const isTransient = (e) => (e instanceof WithingsError ? e.transient : !!e && FS_TRANSIENT.has(e.code));
