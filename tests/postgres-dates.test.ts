import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, types as pgTypes } from "pg";
import { postgresTypes } from "../src/lib/server/db";
import { entryFromRow } from "../src/lib/server/mappers";
import { EMPTY_RESOURCES } from "../src/lib/resources";

test("PostgreSQL DATE keeps Monday weeks in a non-UTC host timezone", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Australia/Sydney";
  try {
    // Demonstrate the native driver's local-midnight behavior that caused the
    // regression, then use the same scoped parser configuration as our Pool.
    const nativeDate = pgTypes.getTypeParser(pgTypes.builtins.DATE, "text")(
      "2026-10-05",
    ) as Date;
    assert.equal(nativeDate.toISOString().slice(0, 10), "2026-10-04");
    const client = new Client({ types: postgresTypes });
    const week = client.getTypeParser(pgTypes.builtins.DATE, "text")("2026-10-05");
    const updatedAt = client.getTypeParser(pgTypes.builtins.TIMESTAMPTZ, "text")(
      "2026-10-05 03:15:00+00",
    );
    const entry = entryFromRow({
      id: "entry-id",
      member_id: "member-id",
      week_start: week,
      resources: EMPTY_RESOURCES,
      notes: "",
      updated_at: updatedAt,
      updated_by: "member-id",
      updated_by_username: "Clan member",
    });
    assert.equal(entry.week, "2026-10-05");
    assert.equal(entry.updatedAt, "2026-10-05T03:15:00.000Z");
    assert.ok(updatedAt instanceof Date);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
