import {spawn} from "node:child_process";

const psql = "/usr/lib/postgresql/16/bin/psql";

export function holdLocalStagingLock() {
  const child = spawn("sudo", ["-u", "postgres", "/usr/bin/stdbuf", "-oL", "-eL", psql, "-d", "postgres", "--no-psqlrc", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  let settled = false;
  return new Promise((resolve, reject) => {
    const fail = message => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(message + "\n" + out + "\n" + err));
    };
    const succeed = () => {
      if (settled || !out.includes("STAGING_DB_LOCK")) return;
      settled = true;
      clearTimeout(timer);
      resolve(() => {
        try {
          child.stdin.write("select pg_advisory_unlock(814213);\n");
          child.stdin.end();
        } catch {
          child.kill();
        }
      });
    };
    const timer = setTimeout(() => fail("Could not lock the local staging database."), 30000);
    child.stdout.on("data", chunk => { out += chunk; succeed(); });
    child.stderr.on("data", chunk => { err += chunk; if (err.includes("ERROR")) fail("Staging lock session failed."); });
    child.on("exit", () => { if (!settled) fail("Staging lock session ended early."); });
    child.stdin.write("select pg_advisory_lock(814213);\nselect 'STAGING_DB_LOCK';\n");
  });
}
