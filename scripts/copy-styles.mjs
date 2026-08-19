// The library entrypoint deliberately does not import CSS, so consumers
// choose when and what to load:
//   @abstractframework/agora-wui/styles.css — theme + components (standalone)
//   @abstractframework/agora-wui/team.css   — components only (embedding
//     hosts that own their page theme and define the token names)
//   @abstractframework/agora-wui/theme.css  — the token/reset layer alone
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
for (const name of ["styles.css", "theme.css", "team.css"]) {
  copyFileSync(`src/ui/${name}`, `dist/${name}`);
  console.log(`copied src/ui/${name} -> dist/${name}`);
}
