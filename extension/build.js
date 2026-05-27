const esbuild = require("esbuild");

const entryPoints = [
  "src/background.ts",
  "src/content.ts",
  "src/popup.ts",
];

const watch = process.argv.includes("--watch");

async function build() {
  const ctx = await esbuild.context({
    entryPoints,
    bundle: true,
    outdir: "dist",
    platform: "browser",
    target: "chrome110",
    format: "iife",
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    console.log("Watching for changes…");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
