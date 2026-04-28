#!/usr/bin/env tsx
import { main } from "../src/lib/memory/cli";

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
