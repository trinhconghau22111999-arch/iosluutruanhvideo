import { google } from "googleapis";
import { db } from "./firebaseAdmin";
import { encrypt, decrypt } from "./crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function buildAuthUrl(state) {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token every time, so each new Google account grants one
    scope: SCOPES,
    state,
  });
}

// Exchanges an auth code for tokens, fetches the account's email, and
// stores the (encrypted) refresh token in Firestore under accounts/{email}.
export async function handleOAuthCallback(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  const email = profile.email;

  if (!tokens.refresh_token) {
    // Google only returns refresh_token on first-ever consent for that
    // client+account pair. If the account was previously connected and then
    // disconnected without revoking, prompt=consent above should still force
    // a fresh one; if not, we keep the existing stored one.
    const existing = await db.collection("accounts").doc(email).get();
    if (!existing.exists) {
      throw new Error(
        `Không nhận được refresh token cho ${email}. Hãy vào https://myaccount.google.com/permissions, gỡ quyền của app này rồi thử kết nối lại.`
      );
    }
  } else {
    await db
      .collection("accounts")
      .doc(email)
      .set(
        {
          email,
          name: profile.name || email,
          picture: profile.picture || null,
          refreshTokenEnc: encrypt(tokens.refresh_token),
          connectedAt: new Date().toISOString(),
        },
        { merge: true }
      );
  }

  return email;
}

export async function getAuthorizedClientForAccount(email) {
  const doc = await db.collection("accounts").doc(email).get();
  if (!doc.exists) throw new Error(`Chưa kết nối tài khoản ${email}`);
  const { refreshTokenEnc } = doc.data();
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: decrypt(refreshTokenEnc) });
  return client;
}

export async function getDriveClient(email) {
  const auth = await getAuthorizedClientForAccount(email);
  return google.drive({ version: "v3", auth });
}

export async function getStorageQuota(email) {
  const drive = await getDriveClient(email);
  const { data } = await drive.about.get({ fields: "storageQuota,user" });
  const q = data.storageQuota || {};
  const limit = q.limit ? Number(q.limit) : null; // null = unlimited (Workspace)
  const usage = q.usage ? Number(q.usage) : 0;
  const free = limit === null ? Number.MAX_SAFE_INTEGER : Math.max(limit - usage, 0);
  return { email, limit, usage, free };
}

export async function getAccessToken(email) {
  const client = await getAuthorizedClientForAccount(email);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error(`Không lấy được access token cho ${email}`);
  return token;
}

// Starts a Google Drive "resumable" upload session and hands back the
// session URL. Only this small JSON request goes through our server; the
// actual file bytes are sent from the browser in small chunks to our own
// /api/drive/upload/chunk route, which relays each chunk to this session URL
// server-side (see that route for why: avoids any dependency on Google's
// CORS policy for the upload endpoint, which isn't something we control).
export async function initResumableUpload(email, { name, mimeType, size }) {
  const accessToken = await getAccessToken(email);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,thumbnailLink,mimeType,createdTime",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({ name, appProperties: { source: "photo-sync-hub" } }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Không khởi tạo được phiên tải lên Drive (${res.status}): ${text}`);
  }

  const sessionUrl = res.headers.get("Location");
  if (!sessionUrl) throw new Error("Google không trả về địa chỉ phiên tải lên");
  return sessionUrl;
}

export async function deleteFileFromDrive(email, fileId) {
  const drive = await getDriveClient(email);
  await drive.files.delete({ fileId });
}

export async function getFileMediaStream(email, fileId) {
  const drive = await getDriveClient(email);
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return res.data;
}
