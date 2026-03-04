import { log } from "./_output.ts";

export interface CompileOpts {
  outDir: string;
  include?: string[];
}

/** Compile the orchestrator server into a standalone binary using `deno compile`. */
export async function runCompile(opts: CompileOpts): Promise<string> {
  const outPath = `${opts.outDir}/server`;

  log.step("Compile", "server/main.ts");

  const t0 = performance.now();
  const args = [
    "compile",
    "--allow-all",
    "--unstable-worker-options",
    "--output",
    outPath,
  ];
  for (const inc of opts.include ?? []) {
    args.push("--include", inc);
  }
  args.push("server/main.ts");

  const cmd = new Deno.Command("deno", {
    args,
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await cmd.output();
  if (!status.success) {
    throw new Error(`deno compile failed with exit code ${status.code}`);
  }

  const stat = await Deno.stat(outPath);
  const mb = ((stat.size ?? 0) / (1024 * 1024)).toFixed(1);
  log.timing("done", performance.now() - t0);
  log.info(`${outPath}  ${log.dim(`${mb}MB`)}`);

  return outPath;
}
