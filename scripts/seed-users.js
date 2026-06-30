#!/usr/bin/env node
/**
 * Seed script for the users table.
 *
 * Usage:
 *   node scripts/seed-users.js          # insert 20 users (default)
 *   node scripts/seed-users.js 50       # insert 50 users
 *   node scripts/seed-users.js 10 --clear  # clear existing seed users first, then insert 10
 */

import pg from "pg";
import crypto from "crypto";
import os from "os";

const { Pool } = pg;

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "c1pay",
  user: process.env.PGUSER || process.env.USER,
});

// All seed usernames get this prefix so --clear can safely remove only them
const SEED_PREFIX = "seed_";

// Deterministic password hash — all seed users share one password: "seedpass123"
function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "_c1pay_salt").digest("hex");
}

const FIRST_NAMES = [
  "alice", "bob", "carol", "dave", "eve", "frank", "grace", "henry",
  "iris", "jack", "kate", "leo", "maya", "noah", "olivia", "peter",
  "quinn", "rose", "sam", "tara", "uma", "victor", "wendy", "xander",
  "yara", "zoe", "aaron", "bella", "carlos", "diana",
];

const LAST_NAMES = [
  "smith", "jones", "patel", "garcia", "wilson", "moore", "taylor",
  "anderson", "thomas", "jackson", "white", "harris", "martin", "thompson",
  "young", "allen", "king", "wright", "scott", "green",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUsername(index) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  const suffix = randomInt(1, 999);
  return `${SEED_PREFIX}${first}_${last}${suffix}`;
}

// Spread created_at over the past 90 days
function randomCreatedAt() {
  const daysAgo = randomInt(0, 90);
  const hoursAgo = randomInt(0, 23);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString();
}

const DEFAULT_BALANCE_CENTS = 100000; // $1000.00

async function clearSeedUsers(client) {
  const res = await client.query(
    `DELETE FROM users WHERE username LIKE $1 RETURNING id`,
    [`${SEED_PREFIX}%`]
  );
  console.log(`Cleared ${res.rowCount} existing seed users.`);
}

async function seed(count, clear) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (clear) await clearSeedUsers(client);

    const passwordHash = hashPassword("seedpass123");
    let inserted = 0;

    for (let i = 0; i < count; i++) {
      const username = randomUsername(i);
      const balance = DEFAULT_BALANCE_CENTS;
      const createdAt = randomCreatedAt();

      await client.query(
        `INSERT INTO users (username, password_hash, balance_cents, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO NOTHING`,
        [username, passwordHash, balance, createdAt]
      );
      inserted++;
    }

    await client.query("COMMIT");
    console.log(`Inserted ${inserted} seed users into the users table.`);
    console.log(`All seed users have password: "seedpass123"`);
    console.log(`To remove them later: node scripts/seed-users.js 0 --clear`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed, rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const count = parseInt(args.find(a => /^\d+$/.test(a)) ?? "20", 10);
const clear = args.includes("--clear");

console.log(`Seeding ${count} users${clear ? " (clearing existing seed users first)" : ""}...`);
seed(count, clear);
