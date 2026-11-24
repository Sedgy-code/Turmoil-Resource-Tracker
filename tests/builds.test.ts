import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { gameName, metaChanges, petName, skillName, statName, type BuildsResponse } from "../src/lib/builds";
import {
  addBuildLink, BUILDS_SOURCE, loadBuildSnapshot, loadBuilds, newestVersions, presetFileCandidates, removeBuildLink, summarizeBuilds, syncBuilds, versionDate,
} from "../src/lib/server/builds";
import { buildsMessage, loadBuildsPage, refreshBuilds, syncBuildsThread, updateBuildsSettings } from "../src/lib/server/builds-discord";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { buildLinkSchema } from "../src/lib/server/validation";
import type { Member } from "../src/lib/types";

// A made-up builds file shaped like 1vcian's Preset Builds file (ProfilePresets.json).
type Pet = [rarity: string, id: number, stats: string[]];
function profile(skills: string[], pets: Pet[], mount: Pet, gear: string[][], fairy: string) {
  const slots = ["Weapon", "Helmet", "Armour", "Gloves", "Boots", "Belt", "Ring", "Necklace"];
  return {
    items: Object.fromEntries(slots.map((slot, index) => [slot, { age: 12, idx: index, level: 149, rarity: "Common", secondaryStats: (gear[index] ?? []).map((statId) => ({ statId, value: 10 })) }])),
    skills: { equipped: skills.map((id) => ({ id, rarity: "Eternal", level: 100, evolution: 0 })) },
    pets: { active: pets.map(([rarity, id, stats]) => ({ rarity, id, level: 100, secondaryStats: stats.map((statId) => ({ statId, value: 80 })) })) },
    mount: { active: { rarity: mount[0], id: mount[1], level: 100, secondaryStats: mount[2].map((statId) => ({ statId, value: 15 })) } },
    misc: { fairy: { name: fairy, level: 20 } },
  };
}
const CRIT_GEAR = Array.from({ length: 8 }, () => ["CriticalChance", "AttackSpeed"]);
const HEAL_GEAR = Array.from({ length: 8 }, () => ["LifeSteal", "DamageMulti"]);
const JELLY: Pet = ["Eternal", 2, ["CriticalMulti", "DoubleDamageChance"]];
const CRANE: Pet = ["Eternal", 0, ["CriticalMulti", "LifeSteal"]];
const STEED: Pet = ["Eternal", 0, ["CriticalMulti", "DamageMulti"]];
function presetsFile(third = "GiantForge", pet: Pet = JELLY) {
  const damage = ["Stomp", "InfiniteRenewal", third];
  const preset = (key: string, category: string, rank: number, weapons: string, skills: string[], fairy: string, extra: Record<string, unknown> = {}) => ({
    key, category, rank, name: `${category} build ${rank}, ${fairy}`, weapons,
    profile: profile(skills, [pet, pet, pet], STEED, skills === damage ? CRIT_GEAR : HEAL_GEAR, fairy),
    metrics: { power: 1, quest: { label: category === "quest" ? "Extreme 4-14" : "Extreme 3-16" }, ...extra },
  });
  return {
    version: "2026_11_16_09_55",
    presets: [
      preset("power1", "power", 1, "melee", damage, "Lora"),
      preset("lab1", "lab", 1, "ranged", damage, "Mira"),
      preset("lab2", "lab", 2, "ranged", damage, "Mira"),
      preset("lab3", "lab", 3, "ranged", damage, "Tira"),
      preset("quest1", "quest", 1, "any", damage, "Lora"),
      preset("quest2", "quest", 2, "any", damage, "Lora"),
      preset("dpsMelee2", "dpsMelee", 2, "melee", damage, "Lora"),
      preset("dpsMelee1", "dpsMelee", 1, "melee", damage, "Lora"),
      preset("dpsRanged1", "dpsRanged", 1, "ranged", damage, "Lora"),
      preset("hpsMelee1", "hpsMelee", 1, "melee", ["Morale", "HigherMorale", "InfiniteRenewal"], "Lora", { testedHps: 100 }),
      preset("hpsRanged1", "hpsRanged", 1, "ranged", ["Morale", "HigherMorale", "InfiniteRenewal"], "Lora", { testedHps: 300 }),
      { key: "broken" },
    ],
    tournament: { battlesPerSide: 100, standings: [
      { key: "lab2", winRate: 0.9436 }, { key: "lab1", winRate: 0.914 }, { key: "dpsRanged1", winRate: 0.714 }, { key: "lab3", winRate: 0.61 },
    ] },
  };
}
const LOCALIZATION = {
  langs: ["en", "ko", "zh-TW"],
  skills: {
    Stomp: { en: "Stomp", ko: "짓밟기" }, InfiniteRenewal: { en: "Infinite Renewal", ko: "무한한 재생", "zh-TW": "無限更新" }, GiantForge: { en: "Giant Forge" },
    Meteorite: { en: "Meteorite" }, Morale: { en: "Morale" }, HigherMorale: { en: "Higher Morale" }, Meat: { en: "Meat" },
  },
  pets: { Eternal_2: { en: "Cosmic Jellyfish", ko: "우주 해파리" }, Eternal_0: { en: "Prism Crane" }, Common_0: { en: "Chicken" } },
  mounts: { Eternal_0: { en: "Spectral Steed" } },
  substats: { CriticalChance: { en: "Critical Chance" }, CriticalMulti: { en: "Critical Damage", ko: "치명타 피해" }, AttackSpeed: { en: "Attack Speed" }, LifeSteal: { en: "Lifesteal" }, DamageMulti: { en: "Damage" }, DoubleDamageChance: { en: "Double Chance" }, BlockChance: { en: "Block Chance" } },
};

let db: Database;
const previous = { ...process.env };
/** What 1vcian's site answers: versions and builds files by path. */
let site: Record<string, unknown> = {};
let siteDown = false;
const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
let discordThreadGone = false;
let posted = 0;
const fetcher = (async (url: string, init: RequestInit = {}) => {
  const method = String(init.method ?? "GET");
  if (url.startsWith(BUILDS_SOURCE)) {
    if (siteDown) throw new Error("offline");
    const path = url.slice(BUILDS_SOURCE.length);
    return path in site ? new Response(JSON.stringify(site[path]), { status: 200 }) : new Response("Not Found", { status: 404 });
  }
  calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : {} });
  if (url.endsWith("/channels/888/messages") && method === "POST") return new Response(JSON.stringify({ id: "intro-1" }), { status: 200 });
  if (url.endsWith("/channels/888/messages/intro-1/threads")) return new Response(JSON.stringify({ id: discordThreadGone ? "thread-2" : "thread-1" }), { status: 201 });
  if (/\/channels\/thread-\d$/.test(url) && method === "PATCH") return discordThreadGone && url.endsWith("thread-1") ? new Response("{}", { status: 404 }) : new Response("{}", { status: 200 });
  if (/\/channels\/thread-\d\/messages$/.test(url) && method === "POST") return new Response(JSON.stringify({ id: `msg-${++posted}` }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot-token", DISCORD_BUILDS_CHANNEL_ID: "888" });
  delete process.env.DEMO_MODE;
  db = await openDatabase({ localPath: "memory://" });
  await initializeSchema(db);
});
after(async () => {
  await db.close();
  process.env = previous;
});

async function addMember(username: string, role: "ADMIN" | "MEMBER" = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1, $2, $3, $4) RETURNING *", [randomUUID(), `d-${username}`, username, role]);
  return memberFromRow(rows[0]);
}
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;

test("game versions are read newest first, and each fairy season's builds file is tried before the plain one", () => {
  assert.equal(versionDate("2026_11_16_09_55"), "2026-11-16T09:55:00.000Z");
  assert.equal(versionDate("2026_04_02"), "2026-04-02T00:00:00.000Z");
  assert.equal(versionDate("latest"), null);
  // The site's own list isn't in order.
  assert.deepEqual(newestVersions(["2026_10_27_09_45", "2026_04_02", "2026_11_16_09_55", "junk", 7, "2026_10_27_09_45"]), ["2026_11_16_09_55", "2026_10_27_09_45", "2026_04_02"]);
  assert.deepEqual(newestVersions(null), []);
  const files = presetFileCandidates(new Date("2026-11-25T03:40:00Z"));
  assert.equal(files[0], "ProfilePresets.fairies_2026_11.json");
  assert.equal(files[1], "ProfilePresets.fairies_2026_10.json");
  assert.ok(files.includes("ProfilePresets.fairies_2026_01.json"));
  assert.equal(files.at(-1), "ProfilePresets.json");
  // A season that starts in the new year isn't picked up before it starts.
  assert.ok(!files.some((file) => file.includes("2026_12") || file.includes("2027")));
  assert.equal(presetFileCandidates(new Date("2027-01-03T00:00:00Z"))[1], "ProfilePresets.fairies_2026_12.json");
});

test("a builds file is boiled down to the best three builds per goal, and what the top builds share", () => {
  const snapshot = summarizeBuilds(presetsFile(), LOCALIZATION, "2026_11_16_09_55", "ProfilePresets.fairies_2026_11.json");
  assert.deepEqual(snapshot.goals.map((entry) => entry.goal), ["arena", "quest", "dpsMelee", "dpsRanged", "healing"]);
  const goal = (name: string) => snapshot.goals.find((entry) => entry.goal === name)!.builds;
  // Arena: in the simulator's tournament order, with each build's win rate.
  assert.deepEqual(goal("arena").map((build) => [build.key, build.arenaWinRate]), [["lab2", 0.9436], ["lab1", 0.914], ["dpsRanged1", 0.714]]);
  // The others by the site's rank; healing by how much it heals, melee and ranged together.
  assert.deepEqual(goal("dpsMelee").map((build) => build.key), ["dpsMelee1", "dpsMelee2"]);
  assert.deepEqual(goal("healing").map((build) => build.key), ["hpsRanged1", "hpsMelee1"]);
  const best = goal("arena")[0];
  assert.equal(best.weapon, "ranged");
  assert.equal(best.fairy, "Mira");
  assert.equal(best.title, "lab build 2, Mira");
  assert.deepEqual(best.gear, [{ stat: "AttackSpeed", rows: 8 }, { stat: "CriticalChance", rows: 8 }]);
  assert.equal(goal("quest")[0].weapon, null);
  assert.equal(goal("quest")[0].quest, "Extreme 4-14");
  // What they share (healing plays differently, so it doesn't count).
  assert.deepEqual(snapshot.meta.skills.map((skill) => skill.id), ["Stomp", "InfiniteRenewal", "GiantForge"]);
  assert.equal(snapshot.meta.pet && petName(snapshot, snapshot.meta.pet, "en"), "Cosmic Jellyfish");
  assert.deepEqual(snapshot.meta.pet?.stats, ["CriticalMulti", "DoubleDamageChance"]);
  assert.deepEqual(snapshot.meta.mountStats, ["CriticalMulti", "DamageMulti"]);
  assert.deepEqual(snapshot.meta.arena, { weapon: "ranged", fairy: "Mira", winRate: 0.9436 });
  // The game's own names in the member's language, English where the game has none.
  assert.equal(skillName(snapshot, { id: "InfiniteRenewal", rarity: "" }, "ko"), "무한한 재생");
  assert.equal(skillName(snapshot, { id: "InfiniteRenewal", rarity: "" }, "zh-Hant"), "無限更新");
  assert.equal(skillName(snapshot, { id: "GiantForge", rarity: "" }, "ko"), "Giant Forge");
  assert.equal(statName(snapshot, "CriticalMulti", "ko"), "치명타 피해");
  assert.equal(statName(snapshot, "CriticalMulti", "vi"), "Critical Damage");
  assert.equal(statName(snapshot, "SkillCooldownMulti", "en"), "Skill Cooldown Multi");
  // Only the names of what is shown are kept.
  assert.ok(!("Meat" in snapshot.names.skills) && !("Common_0" in snapshot.names.pets) && !("BlockChance" in snapshot.names.stats));
  assert.equal(gameName(undefined, "en", "fallback"), "fallback");
  // A file with nothing the Hub can read is refused.
  assert.throws(() => summarizeBuilds({ presets: [{ key: "x" }] }, null, "v", "f"), code("BUILDS_UNREADABLE"));
  assert.throws(() => summarizeBuilds("<html>", null, "v", "f"), code("BUILDS_UNREADABLE"));
  // Without names, the builds still show in English.
  const plain = summarizeBuilds(presetsFile(), null, "2026_11_16_09_55", "f");
  assert.equal(skillName(plain, plain.meta.skills[0], "ko"), "Stomp");
  assert.equal(skillName(plain, { id: "InfiniteRenewal", rarity: "" }, "en"), "Infinite Renewal");
});

test("the daily check stores each game update's builds, archives the old set and says what changed", async () => {
  const leader = await addMember("Lead", "ADMIN");
  const member = await addMember("Member");
  const now = new Date("2026-11-25T03:40:00Z");
  // A new game update (7 Dec) has no builds yet: the site's builds from 16 Nov are used.
  site = {
    "versions.json": ["2026_10_27_09_45", "2026_11_16_09_55"],
    "2026_11_16_09_55/ProfilePresets.fairies_2026_11.json": presetsFile(),
    "2026_10_27_09_45/ProfilePresets.json": presetsFile("Meteorite"),
    "Localization.json": LOCALIZATION,
  };
  const first = await syncBuilds({ db, fetcher, now });
  assert.deepEqual([first.changed, first.version], [true, "2026_11_16_09_55"]);
  assert.deepEqual(await syncBuilds({ db, fetcher, now }).then((result) => result.changed), false);
  let page = await loadBuilds(member, db);
  assert.equal(page.current?.version, "2026_11_16_09_55");
  assert.equal(page.current?.gameDate, "2026-11-16T09:55:00.000Z");
  assert.deepEqual(page.archive, []);
  assert.equal(page.changes, null);
  assert.equal(page.checkedAt, now.toISOString());
  assert.equal(page.canEdit, false);

  // The next game update brings new builds: they become current, the old set is archived.
  const later = new Date("2026-12-08T03:40:00Z");
  site["versions.json"] = ["2026_11_16_09_55", "2026_12_07_10_00"];
  site["2026_12_07_10_00/ProfilePresets.fairies_2026_11.json"] = presetsFile("Meteorite", CRANE);
  const second = await syncBuilds({ db, fetcher, now: later });
  assert.deepEqual([second.changed, second.version], [true, "2026_12_07_10_00"]);
  page = await loadBuilds(member, db);
  assert.equal(page.current?.version, "2026_12_07_10_00");
  assert.deepEqual(page.archive.map((entry) => [entry.version, entry.replacedAt]), [["2026_11_16_09_55", later.toISOString()]]);
  assert.deepEqual(page.changes?.skillsIn, [{ en: "Meteorite" }]);
  assert.deepEqual(page.changes?.skillsOut, [{ en: "Giant Forge" }]);
  assert.deepEqual(page.changes?.pet, { en: "Prism Crane" });
  assert.equal(page.changes?.since, "2026-11-16T09:55:00.000Z");
  // Old sets can be opened from the archive.
  const old = await loadBuildSnapshot(member, page.archive[0].id, db);
  assert.equal(old.data.meta.skills[2].id, "GiantForge");
  await assert.rejects(loadBuildSnapshot(member, 9999, db), code("BUILDS_NOT_FOUND"));

  // The same update's builds redone (the simulator found better ones): the current set is replaced in place.
  const redone = presetsFile("Meteorite", CRANE);
  redone.tournament.standings.reverse();
  site["2026_12_07_10_00/ProfilePresets.fairies_2026_11.json"] = redone;
  assert.equal((await syncBuilds({ db, fetcher, now: later })).changed, true);
  page = await loadBuilds(member, db);
  assert.equal(page.archive.length, 1);
  assert.equal(page.current?.data.goals[0].builds[0].key, "lab3");

  // When the site can't be read, the last good builds stay, and leaders see why.
  siteDown = true;
  const failed = await syncBuilds({ db, fetcher, now: new Date("2026-12-09T03:40:00Z") });
  assert.equal(failed.changed, false);
  assert.equal(failed.error, "Couldn’t reach 1vcian’s site.");
  siteDown = false;
  site["versions.json"] = [];
  assert.equal((await syncBuilds({ db, fetcher, now: later })).error, "1vcian’s site lists no game versions.");
  page = await loadBuilds(member, db);
  assert.equal(page.current?.version, "2026_12_07_10_00");
  assert.equal(page.error, null);
  assert.equal((await loadBuilds(leader, db)).error, "1vcian’s site lists no game versions.");
  // The next good check clears it.
  site["versions.json"] = ["2026_12_07_10_00"];
  await syncBuilds({ db, fetcher, now: later });
  assert.equal((await loadBuilds(leader, db)).error, null);
});

test("leaders add and remove links to other guides; members can only read them", async () => {
  const leader = (await db.query("SELECT * FROM app_members WHERE username = 'Lead'").then((rows) => memberFromRow(rows[0])));
  const member = (await db.query("SELECT * FROM app_members WHERE username = 'Member'").then((rows) => memberFromRow(rows[0])));
  assert.equal(buildLinkSchema.safeParse({ title: "Video", url: "javascript:alert(1)" }).success, false);
  assert.equal(buildLinkSchema.safeParse({ title: "Video", url: "http://example.com" }).success, false);
  assert.equal(buildLinkSchema.safeParse({ title: "", url: "https://example.com" }).success, false);
  const input = buildLinkSchema.parse({ title: " Melee video ", url: "https://youtu.be/abc", note: "Good for mid game" });
  await assert.rejects(addBuildLink(member, input, db), code("ADMIN_REQUIRED"));
  await addBuildLink(leader, input, db);
  let page = await loadBuilds(member, db);
  assert.deepEqual(page.links.map((link) => [link.title, link.url, link.note]), [["Melee video", "https://youtu.be/abc", "Good for mid game"]]);
  await assert.rejects(removeBuildLink(member, page.links[0].id, db), code("ADMIN_REQUIRED"));
  await removeBuildLink(leader, page.links[0].id, db);
  page = await loadBuilds(member, db);
  assert.deepEqual(page.links, []);
});

test("the Discord builds thread: off until a leader switches it on, then a new message per game update with the old ones greyed out", async () => {
  const leader = (await db.query("SELECT * FROM app_members WHERE username = 'Lead'").then((rows) => memberFromRow(rows[0])));
  const member = (await db.query("SELECT * FROM app_members WHERE username = 'Member'").then((rows) => memberFromRow(rows[0])));
  assert.deepEqual(await syncBuildsThread({ db, fetcher }), { posted: false, edited: false, skipped: "off" });
  assert.equal(calls.length, 0);
  // Only leaders see the Discord side, with a preview of the message.
  assert.equal((await loadBuildsPage(member, db)).discord, null);
  const preview = (await loadBuildsPage(leader, db)).discord;
  assert.equal(preview?.enabled, false);
  assert.match(preview?.preview?.embeds[0].title ?? "", /^📈 Meta builds · 7 Dec 2026 game update$/);
  await assert.rejects(updateBuildsSettings(member, { discordEnabled: true }, db), code("ADMIN_REQUIRED"));
  await updateBuildsSettings(leader, { discordEnabled: true }, db);

  // First run: a message in #🛡️-build-guide, a thread off it, and the builds in the thread.
  assert.deepEqual(await syncBuildsThread({ db, fetcher }), { posted: true, edited: false });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace("https://discord.com/api/v10", "")}`), [
    "POST /channels/888/messages", "POST /channels/888/messages/intro-1/threads", "POST /channels/thread-1/messages", "PATCH /channels/888/messages/intro-1",
  ]);
  const message = calls[2].body as { content: string; embeds: { title: string; description: string; color: number }[]; components: { components: { url: string }[] }[]; allowed_mentions: unknown };
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.equal(message.embeds.length, 6);
  assert.match(message.embeds[0].description, /\*\*Skills:\*\* Stomp · Infinite Renewal · Meteorite/);
  assert.match(message.embeds[0].description, /\*\*Changed since 16 Nov 2026:\*\* Meteorite in, Giant Forge out, top pet is now Prism Crane/);
  // The redone builds from the test before put lab3 (Tira) top of the arena.
  assert.match(message.embeds[1].description, /^Ranged · Tira fairy · wins 61% of arena fights · clears Extreme 3-16\n/);
  assert.match(message.embeds[1].description, /\*\*Pets:\*\* Prism Crane \(Critical Damage \+ Lifesteal\) ×3/);
  assert.match(message.embeds[1].description, /\*\*Gear rows:\*\* \(8\) Attack Speed · \(8\) Critical Chance/);
  assert.deepEqual(message.components[0].components.map((button) => button.url), ["https://tracker.example/builds", "https://1vcian.me/fm/#/presets"]);
  const size = message.embeds.reduce((sum, embed) => sum + embed.title.length + embed.description.length, 0);
  assert.ok(size < 6000, `Discord takes up to 6,000 characters of embeds (${size})`);
  assert.equal((await loadBuildsPage(leader, db)).discord?.threadId, "thread-1");

  // Nothing new: nothing is sent.
  calls.length = 0;
  assert.deepEqual(await syncBuildsThread({ db, fetcher }), { posted: false, edited: false });
  assert.equal(calls.length, 0);

  // The same update's builds redone: the message is rewritten in place.
  const redone = presetsFile("Meteorite", CRANE);
  site["2026_12_07_10_00/ProfilePresets.fairies_2026_11.json"] = redone;
  await syncBuilds({ db, fetcher, now: new Date("2026-12-09T03:40:00Z") });
  calls.length = 0;
  assert.deepEqual(await syncBuildsThread({ db, fetcher }), { posted: false, edited: true });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace("https://discord.com/api/v10", "")}`), [
    "PATCH /channels/thread-1", "PATCH /channels/thread-1/messages/msg-1", "PATCH /channels/888/messages/intro-1",
  ]);
  // Discord archives an idle thread after a week: it is woken first.
  assert.deepEqual(calls[0].body, { archived: false });

  // A new game update: the old message is greyed out and marked as old, the new one goes below it.
  site["versions.json"] = ["2027_01_05_09_00"];
  site["2027_01_05_09_00/ProfilePresets.json"] = presetsFile("GiantForge", JELLY);
  const january = new Date("2027-01-06T03:40:00Z");
  await syncBuilds({ db, fetcher, now: january });
  calls.length = 0;
  assert.deepEqual(await syncBuildsThread({ db, fetcher }), { posted: true, edited: false });
  const greyed = calls.find((call) => call.url.endsWith("/channels/thread-1/messages/msg-1"))!.body as { embeds: { title: string; description: string; color: number }[] };
  assert.match(greyed.embeds[0].title, /^🗄️ Old builds · 7 Dec 2026 game update$/);
  assert.match(greyed.embeds[0].description, /^Replaced by newer builds on 6 Jan 2027\. Kept here for reference\./);
  assert.ok(greyed.embeds.every((embed) => embed.color === 0x4f545c));
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/channels/thread-1/messages")));
  // The archive from before the thread existed (16 Nov) was never posted, so nothing to grey.
  assert.equal(calls.filter((call) => call.method === "PATCH" && /messages\/msg-/.test(call.url)).length, 1);

  // Someone deleted the thread: a new one is opened.
  discordThreadGone = true;
  site["2027_01_05_09_00/ProfilePresets.json"] = presetsFile("Meteorite", JELLY);
  await syncBuilds({ db, fetcher, now: january });
  calls.length = 0;
  assert.deepEqual(await syncBuildsThread({ db, fetcher }), { posted: true, edited: false });
  assert.ok(calls.some((call) => call.url.endsWith("/channels/888/messages/intro-1/threads")));
  assert.equal((await loadBuildsPage(leader, db)).discord?.threadId, "thread-2");

  // Switched off: nothing more goes to Discord.
  await updateBuildsSettings(leader, { discordEnabled: false }, db);
  site["2027_01_05_09_00/ProfilePresets.json"] = presetsFile("GiantForge", CRANE);
  calls.length = 0;
  const refreshed: BuildsResponse = await refreshBuilds(leader, { db, fetcher, now: january });
  assert.equal(calls.length, 0);
  assert.equal(refreshed.current?.data.meta.skills[2].id, "GiantForge");
  await assert.rejects(refreshBuilds(member, { db, fetcher, now: january }), code("ADMIN_REQUIRED"));
});

test("an old build set's message says when it was replaced, and nothing changed means no changes line", () => {
  const snapshot = summarizeBuilds(presetsFile(), LOCALIZATION, "2026_11_16_09_55", "f");
  const fresh = buildsMessage(snapshot, {});
  assert.equal(fresh.embeds[0].title, "📈 Meta builds · 16 Nov 2026 game update");
  assert.ok(!fresh.embeds[0].description.includes("Changed"));
  assert.equal(fresh.content, "The best build for each goal right now. Older builds are further up this thread.");
  const old = buildsMessage(snapshot, { replacedAt: "2026-12-08T03:40:00Z" });
  assert.equal(old.content, "");
  assert.match(old.embeds[0].description, /^Replaced by newer builds on 8 Dec 2026\./);
  assert.equal(metaChanges(snapshot, snapshot), null);
});
