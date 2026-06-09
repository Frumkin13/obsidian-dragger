import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dragger-npm-consumer-"));
const npmCli = process.env.npm_execpath;
const packageName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name;

function run(command, args, options = {}) {
    execFileSync(command, args, {
        cwd: options.cwd ?? root,
        stdio: "inherit",
    });
}

function runNpm(args, options = {}) {
    if (npmCli) {
        run(process.execPath, [npmCli, ...args], options);
        return;
    }
    run("npm", args, options);
}

function readNpm(args, options = {}) {
    if (npmCli) {
        return execFileSync(process.execPath, [npmCli, ...args], {
            cwd: options.cwd ?? root,
            encoding: "utf8",
        });
    }
    return execFileSync("npm", args, {
        cwd: options.cwd ?? root,
        encoding: "utf8",
    });
}

try {
    const packJson = readNpm(["pack", "--json"]);
    const [{ filename }] = JSON.parse(packJson);
    const tarball = path.join(root, filename);

    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({
        type: "module",
        scripts: {
            esm: "node esm.mjs",
            cjs: "node cjs.cjs",
            typecheck: "node ./node_modules/typescript/bin/tsc -p tsconfig.json",
        },
        dependencies: {
            typescript: "^4.9.0",
        },
    }, null, 2));

    fs.writeFileSync(path.join(tempDir, "esm.mjs"), `
import { createDragPipeline } from "${packageName}/drag";
import { BlockType } from "${packageName}/domain";
import { parseLineWithQuote } from "${packageName}/markdown";
const block = { type: BlockType.Paragraph, startLine: 0, endLine: 0, from: 0, to: 5, indentLevel: 0, content: "alpha" };
const selection = { anchorBlock: block, focusBlock: block, ranges: [{ startLine: 0, endLine: 0 }] };
const pipeline = createDragPipeline();
const next = pipeline.enter({ type: "hold_start", sessionId: "s1", target: { selection, source: "handle" } });
if (next.current.type !== "holding") throw new Error("missing drag pipeline");
if (BlockType.Paragraph !== "paragraph") throw new Error("missing domain export");
if (parseLineWithQuote("alpha", 4).content !== "alpha") throw new Error("missing markdown export");
console.log("esm ok");
`);

    fs.writeFileSync(path.join(tempDir, "cjs.cjs"), `
const { createDragPipeline } = require("${packageName}/drag");
const { BlockType } = require("${packageName}/domain");
const { parseLineWithQuote } = require("${packageName}/markdown");
const block = { type: BlockType.Paragraph, startLine: 0, endLine: 0, from: 0, to: 5, indentLevel: 0, content: "alpha" };
const selection = { anchorBlock: block, focusBlock: block, ranges: [{ startLine: 0, endLine: 0 }] };
const pipeline = createDragPipeline();
const next = pipeline.enter({ type: "hold_start", sessionId: "s1", target: { selection, source: "handle" } });
if (next.current.type !== "holding") throw new Error("missing drag pipeline");
if (BlockType.Paragraph !== "paragraph") throw new Error("missing domain export");
if (parseLineWithQuote("alpha", 4).content !== "alpha") throw new Error("missing markdown export");
console.log("cjs ok");
`);

    fs.writeFileSync(path.join(tempDir, "typecheck.ts"), `
import { createDragPipeline, type DragDropSnapshot, type DropResolution, type PipelineOutput } from "${packageName}/drag";
import { BlockType, createMoveCommand, createSingleBlockSelection } from "${packageName}/domain";

type PreviewData = { marker: string };
const block = { type: BlockType.Paragraph, startLine: 0, endLine: 0, from: 0, to: 5, indentLevel: 0, content: "alpha" };
const selection = createSingleBlockSelection(block);
const drop: DragDropSnapshot<PreviewData> = {
    target: { targetLineNumber: 2, placement: "before" },
    rejectReason: null,
    previewData: { marker: "typed" },
};
if (!drop.target) throw new Error("missing target");
const pipeline = createDragPipeline<PreviewData>();
const hold = pipeline.enter({
    type: "hold_start",
    sessionId: "s1",
    target: { selection, source: "handle" },
    pointerType: "mouse",
});
const ready = pipeline.enter({ type: "hold_ready", sessionId: "s1", pointerType: "mouse" });
const dragging = pipeline.enter({ type: "drag_start", sessionId: "s1", drop, pointerType: "mouse" });
const resolution: DropResolution<PreviewData> = {
    type: "command",
    command: createMoveCommand(selection, drop.target),
    drop,
};
const committed = pipeline.enter({ type: "drop", sessionId: "s1", resolution, pointerType: "mouse" });
const outputs: PipelineOutput<PreviewData>[] = committed.outputs;
if (!outputs.some((output) => output.type === "command_ready")) throw new Error("missing command output");
`);

    fs.writeFileSync(path.join(tempDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
            target: "ES2020",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
        },
        include: ["typecheck.ts"],
    }, null, 2));

    runNpm(["install", tarball, "--ignore-scripts"], { cwd: tempDir });
    runNpm(["run", "esm"], { cwd: tempDir });
    runNpm(["run", "cjs"], { cwd: tempDir });
    runNpm(["run", "typecheck"], { cwd: tempDir });
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    for (const file of fs.readdirSync(root)) {
        if (new RegExp(`^${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\.\\d+\\.\\d+\\.tgz$`).test(file)) {
            fs.rmSync(path.join(root, file), { force: true });
        }
    }
}
