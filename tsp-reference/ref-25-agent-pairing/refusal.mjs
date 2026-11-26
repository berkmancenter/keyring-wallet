// refusal.mjs: reading what a mediator says when it will not do something.
//
// A refusal arrives two ways. A REST call answers with a status and a JSON
// body (`{ sessionId, httpCode, errorCode, errorCodeStr, message }`), and a
// queue-limit refusal adds a `Retry-After` header. A socket answers with a
// DIDComm problem report whose `body.code` is `<sorter>.<scope>.<descriptor>`.
// Both are reduced here to one shape, so a case can assert on the code and
// never on prose.

/** A DIDComm problem code: `e` or `w`, then `p` or `m`, then the descriptor. */
const PROBLEM_CODE = /\b[ew]\.[pm](?:\.[a-z0-9_]+)+\b/;

export const PROBLEM_REPORT = "https://didcomm.org/report-problem/2.0/problem-report";

/**
 * `Retry-After` as whole seconds from `now`: the header is either a count of
 * seconds or an HTTP date. Anything else, or nothing, is `undefined`.
 */
export function retryAfterSeconds(value, now = Date.now()) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  // An HTTP date begins with the day's name. `Date.parse` alone would read "-3" as a year.
  if (!/^[A-Za-z]{3},? /.test(text)) return undefined;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

const headerOf = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};

/**
 * A REST answer, reduced. `body` is the parsed JSON, or the text when it was
 * not JSON. `refused` is false for any 2xx status.
 */
export function readRestAnswer({ status, headers, body }, now = Date.now()) {
  const record = body && typeof body === "object" ? body : {};
  const texts = [record.errorCodeStr, record.message, typeof body === "string" ? body : undefined].filter(
    (t) => typeof t === "string",
  );
  const code = texts.map((t) => PROBLEM_CODE.exec(t)?.[0]).find(Boolean);
  return {
    refused: !(status >= 200 && status < 300),
    status,
    errorCode: typeof record.errorCode === "number" ? record.errorCode : undefined,
    code,
    message: typeof record.message === "string" ? record.message : undefined,
    retryAfter: retryAfterSeconds(headerOf(headers, "retry-after"), now),
  };
}

/** A problem report received on the socket, reduced; `undefined` for any other message. */
export function readProblemReport(message) {
  if (!message || message.type !== PROBLEM_REPORT) return undefined;
  const body = message.body ?? {};
  return {
    code: typeof body.code === "string" ? body.code : undefined,
    comment: typeof body.comment === "string" ? body.comment : undefined,
    args: Array.isArray(body.args) ? body.args : [],
    pthid: message.pthid,
    thid: message.thid,
  };
}

/** Whether a reduced refusal carries `code`, exactly. */
export const refusedWith = (answer, code) => Boolean(answer?.refused) && answer.code === code;
