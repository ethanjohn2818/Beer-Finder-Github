// ---------------------------------------------------------------
// One-off: copy accounts from the OLD Supabase project to a NEW one
// (auth users, profiles, beers_had). Run this locally, once, after
// applying supabase/schema.sql to the new project.
//
// This needs the SERVICE ROLE key for both projects (full-access secrets —
// never commit them, never put them in auth.js). Export them as env vars
// in your shell for this run only:
//
//   export OLD_SB_URL=https://vccbkemmnjqjxmzycooy.supabase.co
//   export OLD_SB_SERVICE_KEY=...   (old project > Settings > API > service_role)
//   export NEW_SB_URL=https://<new-project-ref>.supabase.co
//   export NEW_SB_SERVICE_KEY=...   (new project > Settings > API > service_role)
//   node scripts/migrateSupabase.js
//
// Safe to re-run: existing rows in the new project are left alone (upsert /
// "already exists" errors are skipped, not fatal).
// ---------------------------------------------------------------

const { createClient } = require("@supabase/supabase-js");

const { OLD_SB_URL, OLD_SB_SERVICE_KEY, NEW_SB_URL, NEW_SB_SERVICE_KEY } = process.env;

if (!OLD_SB_URL || !OLD_SB_SERVICE_KEY || !NEW_SB_URL || !NEW_SB_SERVICE_KEY) {
    console.error("Set OLD_SB_URL, OLD_SB_SERVICE_KEY, NEW_SB_URL, NEW_SB_SERVICE_KEY first.");
    process.exit(1);
}

const oldSb = createClient(OLD_SB_URL, OLD_SB_SERVICE_KEY, { auth: { persistSession: false } });
const newSb = createClient(NEW_SB_URL, NEW_SB_SERVICE_KEY, { auth: { persistSession: false } });

// Old user id -> new user id (only differs if the new project couldn't
// honour the requested id, e.g. a rare uuid collision).
const idMap = new Map();

async function listAllUsers(sb) {
    const users = [];
    for (let page = 1; ; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 1000) break;
    }
    return users;
}

async function migrateAuthUsers() {
    const users = await listAllUsers(oldSb);
    console.log(`Found ${users.length} auth users in the old project.`);

    for (const u of users) {
        if (!u.email) { console.warn(`Skipping ${u.id}: no email (phone/anonymous user?).`); continue; }

        const { data, error } = await newSb.auth.admin.createUser({
            id: u.id,                       // keep the same id so profiles/beers_had just carry over
            email: u.email,
            email_confirm: true,            // they've already verified this email on the old project
            app_metadata: u.app_metadata,
            user_metadata: u.user_metadata,
        });

        if (error) {
            if (/already been registered|already exists/i.test(error.message)) {
                idMap.set(u.id, u.id);      // already migrated on a previous run
                continue;
            }
            console.error(`Failed to create ${u.email}: ${error.message}`);
            continue;
        }
        idMap.set(u.id, data.user.id);
    }
    console.log(`Migrated ${idMap.size}/${users.length} auth users.`);
}

async function migrateTable(name, columns) {
    const { data, error } = await oldSb.from(name).select(columns.join(","));
    if (error) throw error;
    console.log(`Copying ${data.length} rows from ${name}...`);

    let ok = 0, skipped = 0;
    for (const row of data) {
        const mappedId = idMap.get(row.user_id || row.id);
        if (!mappedId) { skipped++; continue; }   // user failed to migrate above

        const newRow = { ...row };
        if ("id" in newRow) newRow.id = mappedId;
        if ("user_id" in newRow) newRow.user_id = mappedId;

        const { error: insertError } = await newSb.from(name).insert(newRow);
        if (insertError) {
            if (/duplicate|unique/i.test(insertError.message)) { skipped++; continue; }
            console.error(`  ${name} row failed: ${insertError.message}`);
            continue;
        }
        ok++;
    }
    console.log(`  ${name}: ${ok} inserted, ${skipped} skipped (already present or unmapped user).`);
}

(async () => {
    await migrateAuthUsers();
    await migrateTable("profiles", ["id", "username", "created_at"]);
    await migrateTable("beers_had", ["user_id", "beer_key", "beer_name", "created_at"]);
    console.log("Done.");
})();
