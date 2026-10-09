import { describe, expect, it } from "vitest";
import { toolContractAnalyzer } from "./tool-contract.js";
import type { DiffFile, PullRequestRef } from "../types.js";

const pr: PullRequestRef = { owner: "", repo: "", number: 0, sha: "", base: "", head: "" };

function file(patch: string, filename = "src/app.ts"): DiffFile {
  return { filename, status: "modified", patch, additions: 0, deletions: 0 };
}

const run = (patch: string, filename?: string) => toolContractAnalyzer.analyze(pr, [file(patch, filename)]);

describe("toolContractAnalyzer", () => {
  it("flags an added tool without annotations", async () => {
    const findings = await run(`@@ -10,3 +10,8 @@
   const tools: FabricTool[] = [
+    { name: 'pve_start_vm', description: 'Start a VM on a Proxmox node.',
+      inputSchema: { type: 'object', properties: {} },
+      execute: async () => pve.post('/start') },
   ];`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "HIGH", category: "contract", line: 11 });
    expect(findings[0].message).toContain("pve_start_vm");
  });

  it("accepts an annotated tool with a full description", async () => {
    const findings = await run(`@@ -10,3 +10,9 @@
   const tools: FabricTool[] = [
+    { name: 'pve_list_vms', description: 'List VMs across all nodes or one node.',
+      annotations: { readOnlyHint: true },
+      inputSchema: { type: 'object', properties: {} },
+      execute: async () => pve.get('/qemu') },
   ];`);
    expect(findings).toEqual([]);
  });

  it("flags a short added description", async () => {
    const findings = await run(`@@ -1,2 +1,6 @@
+      {
+        name: "git_pr_merge",
+        description: "Merge a PR.",
+        annotations: { readOnlyHint: false, destructiveHint: false },
+        async execute(args) { return args; },
+      },`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "MEDIUM", line: 2 });
  });

  it("joins concatenated description literals", async () => {
    const findings = await run(`@@ -1,2 +1,8 @@
+      {
+        name: "chat_briefing",
+        description:
+          "Generate a " +
+          "service briefing.",
+        annotations: { readOnlyHint: true },
+        execute: async () => "",
+      },`);
    expect(findings).toEqual([]);
  });

  it("does not flag an unchanged description when only annotations were added", async () => {
    const findings = await run(`@@ -50,3 +50,4 @@
     { name: 'pve_reboot_vm', description: 'Reboot a VM.',
+      annotations: { readOnlyHint: false, destructiveHint: false },
       inputSchema: { type: 'object', properties: {} },
       execute: async (a) => pve.post('/reboot') },`);
    expect(findings).toEqual([]);
  });

  it("skips a tool cut off by the hunk boundary", async () => {
    const findings = await run(`@@ -10,3 +10,4 @@
   const tools: FabricTool[] = [
+    { name: 'ts_set_acl', description: 'Set the tailnet ACL policy document.',
       inputSchema: { type: 'object', properties: {} },`);
    expect(findings).toEqual([]);
  });

  it("ignores context-only tools and non-tool names", async () => {
    const findings = await run(`@@ -1,4 +1,5 @@
     { name: 'k8s_list_pods', description: 'List pods.', inputSchema: {}, execute: async () => [] },
+  // comment
   return {
     name: "@git-fabric/k8s",`);
    expect(findings).toEqual([]);
  });

  it("ignores tests and files outside src/lib", async () => {
    const patch = `@@ -1,1 +1,3 @@
+    { name: 'x_tool', description: 'x',
+      execute: async () => 1 },`;
    expect(await run(patch, "src/app.test.ts")).toEqual([]);
    expect(await run(patch, "dist/app.js")).toEqual([]);
    expect(await run(patch, "src/app.ts")).toHaveLength(2);
  });
});
