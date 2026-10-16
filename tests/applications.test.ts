import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { decideApplication, listApplications, saveApplicationSettings, submitApplication, APPLICATIONS_CHANNEL_ID } from "../src/lib/server/applications";
import { handleInteraction } from "../src/lib/server/discord-interactions";
import { memberFromRow } from "../src/lib/server/mappers";

let db: Database;
const previous = { ...process.env };
const adminId = randomUUID();
const input = { gameName: "Newbie", discordName: "newbie#1", power: "500t", stage: "Hard 9-1", server: "27", timezone: "UTC+1", warDays: "7", languages: "English", about: "Hi!" };
const sent: { url: string; method: string; body: Record<string, unknown> }[] = [];
const fetcher = (async (url: string, init: RequestInit) => {
  sent.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
  return new Response(JSON.stringify({ id: "999" }), { status: 200 });
}) as typeof fetch;

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "test-token" });
  db = await openDatabase();
  await initializeSchema(db);
  await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1, '42', 'boss', 'ADMIN')", [adminId]);
});
after(async () => { await db.close(); process.env = previous; });
const admin = async () => memberFromRow((await db.query("SELECT * FROM app_members WHERE id = $1", [adminId]))[0]);

test("an application is saved and posted to the private channel with buttons", async () => {
  const application = await submitApplication(input, "1.2.3.4", { db, fetcher });
  assert.equal(application.status, "pending");
  assert.equal(sent[0].url, `https://discord.com/api/v10/channels/${APPLICATIONS_CHANNEL_ID}/messages`);
  const components = sent[0].body.components as { components: { custom_id?: string }[] }[];
  assert.equal(components[0].components[0].custom_id, `app:accepted:${application.id}`);
  const listed = await listApplications(await admin(), db);
  assert.equal(listed.applications.length, 1);
});

test("too many applications from one place are refused", async () => {
  await submitApplication(input, "5.5.5.5", { db, fetcher });
  await submitApplication(input, "5.5.5.5", { db, fetcher });
  await submitApplication(input, "5.5.5.5", { db, fetcher });
  await assert.rejects(submitApplication(input, "5.5.5.5", { db, fetcher }), /wait an hour/);
});

test("accepting on the Hub updates the Discord message; answering twice is refused", async () => {
  const application = await submitApplication(input, "9.9.9.9", { db, fetcher });
  sent.length = 0;
  const accepted = await decideApplication(await admin(), application.id, "accepted", { db, fetcher });
  assert.equal(accepted.status, "accepted");
  assert.equal(sent[0].method, "PATCH");
  assert.deepEqual(sent[0].body.components, []);
  await assert.rejects(decideApplication(await admin(), application.id, "declined", { db, fetcher }), /already answered/);
});

test("Discord Decline button works for admins only", async () => {
  const application = await submitApplication(input, "8.8.8.8", { db, fetcher });
  const press = (discordId: string) => handleInteraction({ type: 3, member: { user: { id: discordId } }, data: { custom_id: `app:declined:${application.id}` } }, db);
  const stranger = await press("7") as { type: number; data: { content: string } };
  assert.equal(stranger.type, 4);
  const done = await press("42") as { type: number; data: { embeds: { footer: { text: string } }[] } };
  assert.equal(done.type, 7);
  assert.match(done.data.embeds[0].footer.text, /Declined by boss/);
});

test("closed applications are refused", async () => {
  await saveApplicationSettings(await admin(), { open: false }, db);
  await assert.rejects(submitApplication(input, "7.7.7.7", { db, fetcher }), /isn’t taking applications/);
});
