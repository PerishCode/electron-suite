import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface Record {
  schema: 1;
  scope: string;
  incarnation: string;
  pid: number;
  phase: "active" | "closed";
}

// SQLite's exclusive locking mode retains the OS lock across commits. Keeping
// the database open fences other processes while the committed owner survives a
// crash. Never unlink this file, steal by PID/mtime, or treat a partial claim as absent.
export class Ownership {
  readonly fresh: boolean;
  readonly incarnation = randomUUID();
  private closed = false;
  private constructor(
    private db: DatabaseSync,
    private scope: string,
    fresh: boolean,
  ) {
    this.fresh = fresh;
  }

  static async claim(path: string): Promise<Ownership> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(path));
    const scope = join(parent, basename(path));
    let fresh = false;
    try {
      const file = await open(scope, "wx", 0o600);
      await file.close();
      fresh = true;
    } catch (fault) {
      if ((fault as NodeJS.ErrnoException).code !== "EEXIST") throw fault;
    }
    if (!(await lstat(scope)).isFile()) throw new Error("ownership must be a regular file");
    const db = new DatabaseSync(scope, { timeout: 0 });
    try {
      db.exec("PRAGMA locking_mode=EXCLUSIVE");
      // A reader of the just-created, unpublished file can briefly win SQLite's
      // lock before its unique creator initializes the schema. Only that creator
      // retries; no contender can use this wait to take over an existing claim.
      const deadline = Date.now() + 500;
      for (;;) {
        try {
          db.exec("BEGIN EXCLUSIVE");
          break;
        } catch (fault) {
          if (!fresh || (fault as { errcode?: number }).errcode !== 5 || Date.now() >= deadline) throw fault;
          await new Promise((done) => setTimeout(done, 5));
        }
      }
      if (fresh) db.exec("CREATE TABLE authority (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL) STRICT;");
      const row = db.prepare("SELECT record FROM authority WHERE id=1").get();
      if (!row && !fresh) throw new Error("ownership is unpublished; recovery required");
      if (row) {
        const value = JSON.parse(String(row.record)) as Record;
        if (
          value.schema !== 1 ||
          value.scope !== scope ||
          !/^[0-9a-f-]{36}$/.test(value.incarnation) ||
          !Number.isSafeInteger(value.pid) ||
          value.pid < 1 ||
          !["active", "closed"].includes(value.phase)
        )
          throw new Error("ownership is invalid; recovery required");
        if (value.phase === "active") throw new Error("ownership was interrupted; recovery required");
      }
      const owner = new Ownership(db, scope, fresh);
      owner.save("active");
      db.exec("COMMIT");
      return owner;
    } catch (fault) {
      db.close();
      if ([5, 6].includes((fault as { errcode?: number }).errcode ?? 0))
        throw new Error("ownership is held by another manager", { cause: fault });
      if (fault instanceof Error && fault.message.startsWith("ownership")) throw fault;
      throw new Error("ownership is invalid or unpublished; recovery required", { cause: fault });
    }
  }

  // Release after verified normal drain only. Failed startup/cleanup uses abandon
  // so the next opener sees an interrupted authority and cannot erase resources.
  close(): void {
    if (this.closed) return;
    this.db.exec("BEGIN EXCLUSIVE");
    try {
      this.save("closed");
      this.db.exec("COMMIT");
    } catch (fault) {
      this.db.exec("ROLLBACK");
      throw fault;
    }
    this.db.close();
    this.closed = true;
  }

  abandon(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private save(phase: Record["phase"]): void {
    const record: Record = { schema: 1, scope: this.scope, incarnation: this.incarnation, pid: process.pid, phase };
    this.db.prepare("INSERT OR REPLACE INTO authority(id,record) VALUES(1,?)").run(JSON.stringify(record));
  }
}
