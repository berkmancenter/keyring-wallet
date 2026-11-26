// Two schema sets, both read straight from the checkouts (nothing copied, nothing generated):
//  - the proposed Trust Task payload schemas, from the PR branch's specs/ (hcp/*, task-consent/*,
//    and the framework's error / next-step / discovery);
//  - HCP's own JSON Schemas at the commit the PR cites (hcp-spec schemas/2.0-draft-3).
// A payload that crosses the wire in this rung is checked against the first, and, where HCP has a
// schema for the same thing, against the second.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

export class Schemas {
  private tt = addFormats(new Ajv2020({ strict: false, allErrors: true }));
  private hcp = addFormats(new Ajv2020({ strict: false, allErrors: true }));
  /** bare Type URI -> the file id its payload schema was registered under */
  private byType = new Map<string, string>();

  constructor(ttRoot: string, hcpRoot: string) {
    const specs = join(ttRoot, "specs");
    for (const family of readdirSync(specs).filter((d) => statSync(join(specs, d)).isDirectory())) {
      for (const file of walk(join(specs, family))) {
        if (!file.endsWith(".schema.json")) continue;
        const schema = JSON.parse(readFileSync(file, "utf8"));
        // Cross-file $refs in specs/ are relative to the FILE, not to the published $id, so each
        // schema is registered under its file URL and keeps its published id only as the type key.
        const fileId = pathToFileURL(file).href;
        if (typeof schema.$id === "string" && file.endsWith("payload.schema.json")) this.byType.set(schema.$id, fileId);
        this.tt.addSchema({ ...schema, $id: fileId });
      }
    }
    for (const file of walk(join(hcpRoot, "schemas", "2.0-draft-3"))) {
      const schema = JSON.parse(readFileSync(file, "utf8"));
      if (typeof schema.$id === "string") this.hcp.addSchema(schema);
    }
  }

  knows(type: string): boolean {
    return this.byType.has(type.split("#")[0]!);
  }

  /** Errors of `payload` against the proposed Trust Task schema for `type` ([] = valid). */
  checkTrustTask(type: string, payload: unknown): string[] {
    const [bare, fragment] = type.split("#");
    const fileId = this.byType.get(bare!);
    if (!fileId) return [`no proposed schema for ${bare}`];
    const ref = fragment === "response" ? `${fileId}#/$defs/Response` : fileId;
    try {
      const validate = this.tt.getSchema(ref) ?? this.tt.compile({ $ref: ref });
      return validate(payload) ? [] : (validate.errors ?? []).map((e) => `payload${e.instancePath} ${e.message}`);
    } catch (e: any) {
      return [`(the rung could not compile the schema: ${e?.message ?? e})`];
    }
  }

  /** Errors of `value` against one of HCP's own schemas, by file name (e.g. "grant.json"). */
  checkHcp(name: string, value: unknown): string[] {
    const id = `https://hcp.example/schemas/2.0-draft-3/${name}`;
    const validate = this.hcp.getSchema(id);
    if (!validate) return [`HCP has no schema ${name}`];
    return validate(value) ? [] : (validate.errors ?? []).map((e) => `${name}${e.instancePath} ${e.message}`);
  }
}
