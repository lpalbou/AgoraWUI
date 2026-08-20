// The library entrypoint deliberately does not import CSS, so consumers
// choose when and what to load:
//   @abstractframework/agora-wui/styles.css — theme + components (standalone)
//   @abstractframework/agora-wui/team.css   — components only (embedding
//     hosts that own their page theme and define the token names)
//   @abstractframework/agora-wui/theme.css  — the token/reset layer alone
//
// styles.css is CONCATENATED here rather than shipped as two `@import`s:
// an @import chain must lead the file, costs consumers an extra request,
// and breaks when a bundler inlines the sheet into a <style> tag, because
// the relative imports then resolve against the page instead of the
// stylesheet.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
for (const name of ["theme.css", "team.css"]) {
  copyFileSync(`src/ui/${name}`, `dist/${name}`);
  console.log(`copied src/ui/${name} -> dist/${name}`);
}
const banner =
  "/* Agora WUI: the theme layer (tokens, reset, element rules) followed by\n" +
  "   the class-scoped team layer. Import team.css alone when your host owns\n" +
  "   the page theme and provides the token names; see docs/api.md. */\n";
writeFileSync(
  "dist/styles.css",
  banner + readFileSync("src/ui/theme.css", "utf8") + "\n" + readFileSync("src/ui/team.css", "utf8"),
);
console.log("wrote dist/styles.css (theme + team, concatenated)");
