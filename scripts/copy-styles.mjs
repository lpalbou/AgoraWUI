// The library entrypoint deliberately does not import CSS, so consumers choose
// when to load it. Ship the stylesheet as `@abstractframework/agora-wui/styles.css`.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("src/ui/styles.css", "dist/styles.css");
console.log("copied src/ui/styles.css -> dist/styles.css");
