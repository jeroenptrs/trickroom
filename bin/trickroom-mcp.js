#!/usr/bin/env node
import { changeProjectRoot } from "./project-root.js";

changeProjectRoot();

const runtime = await import("../dist/mcp-stdio.js");

await runtime.main();
