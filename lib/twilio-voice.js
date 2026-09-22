function getTwilioAuthFromEnv() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const apiKeySid = process.env.TWILIO_API_KEY_SID || "";
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";
  const useAuthToken = Boolean(accountSid.startsWith("AC") && authToken);
  const useApiKey = Boolean(accountSid.startsWith("AC") && apiKeySid.startsWith("SK") && apiKeySecret);
  return {
    accountSid,
    useAuthToken,
    useApiKey,
    authUser: useAuthToken ? accountSid : apiKeySid,
    authPass: useAuthToken ? authToken : apiKeySecret,
    authMode: useAuthToken ? "auth_token" : useApiKey ? "api_key" : "none"
  };
}

async function createTwilioCall({ to, from, twiml, url }) {
  const twilio = getTwilioAuthFromEnv();
  const missing = [];
  if (!twilio.accountSid.startsWith("AC")) missing.push("TWILIO_ACCOUNT_SID");
  if (!twilio.useAuthToken && !twilio.useApiKey) missing.push("TWILIO_AUTH_TOKEN");
  if (!from) missing.push("TWILIO_FROM_NUMBER");
  if (!to) missing.push("to");
  if (!twiml && !url) missing.push("twiml or url");
  if (missing.length) {
    return { status: "error", summary: `Twilio not configured: ${missing.join(", ")}`, artifacts: { missing } };
  }

  const auth = Buffer.from(`${twilio.authUser}:${twilio.authPass}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: from });
  if (url) form.set("Url", url);
  if (twiml) form.set("Twiml", twiml);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Calls.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: "error",
      summary: `Twilio call failed: ${payload.message || `HTTP ${response.status}`}`,
      artifacts: { twilio_status: response.status, twilio_code: payload.code || null, twilio_message: payload.message || null }
    };
  }
  return {
    status: "success",
    summary: `Twilio call ${payload.sid}`,
    artifacts: {
      call_sid: payload.sid,
      to,
      from,
      status: payload.status,
      auth_mode: twilio.authMode
    }
  };
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sayTwiml(messages) {
  const parts = (Array.isArray(messages) ? messages : [messages])
    .filter(Boolean)
    .map((text) => `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>`)
    .join("");
  return `<Response>${parts}</Response>`;
}

module.exports = {
  createTwilioCall,
  escapeXml,
  sayTwiml,
  getTwilioAuthFromEnv
};
