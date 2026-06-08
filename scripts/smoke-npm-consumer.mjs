import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dragger-npm-consumer-"));
const npmCli = process.env.npm_execpath;

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
import { DragFlowController } from "dragger/drag";
import { BlockType } from "dragger/domain";
import { parseLineWithQuote } from "dragger/markdown";
const flow = new DragFlowController();
if (typeof flow.begin !== "function") throw new Error("missing drag flow");
if (BlockType.Paragraph !== "paragraph") throw new Error("missing domain export");
if (typeof parseLineWithQuote !== "function") throw new Error("missing markdown export");
console.log("esm ok");
`);

    fs.writeFileSync(path.join(tempDir, "cjs.cjs"), `
const { DragFlowController } = require("dragger/drag");
const { BlockType } = require("dragger/domain");
const { parseLineWithQuote } = require("dragger/markdown");
const flow = new DragFlowController();
if (typeof flow.begin !== "function") throw new Error("missing drag flow");
if (BlockType.Paragraph !== "paragraph") throw new Error("missing domain export");
if (typeof parseLineWithQuote !== "function") throw new Error("missing markdown export");
console.log("cjs ok");
`);

    fs.writeFileSync(path.join(tempDir, "typecheck.ts"), `
import { DragFlowController, executeDragEffects, type DragEffectExecutor, type DragDropSnapshot, type DropCommitResolution } from "dragger/drag";
import { BlockType, createMoveCommand, createSingleBlockSelection } from "dragger/domain";

type PreviewData = { marker: string };
const block = { type: BlockType.Paragraph, startLine: 0, endLine: 0, from: 0, to: 5, indentLevel: 0, content: "alpha" };
const selection = createSingleBlockSelection(block);
const drop: DragDropSnapshot<PreviewData> = {
    target: { targetLineNumber: 2, placement: "before" },
    rejectReason: null,
    previewData: { marker: "typed" },
};
if (!drop.target) throw new Error("missing target");
const resolution: DropCommitResolution<PreviewData> = {
    type: "command",
    command: createMoveCommand(selection, drop.target),
    drop,
};
const flow = new DragFlowController<PreviewData>();
flow.begin({ selection, pointerId: 1, pointerType: "mouse", drop });
const executor: DragEffectExecutor<PreviewData> = {
    showDropPreview: (_selection, value) => value.previewData?.marker.toUpperCase(),
    hideDropPreview: () => undefined,
    applyCommand: () => undefined,
    emitLifecycle: () => undefined,
};
executeDragEffects(executor, flow.commit({ pointerId: 1, pointerType: "mouse", resolution }));
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
        if (/^dragger-\d+\.\d+\.\d+\.tgz$/.test(file)) {
            fs.rmSync(path.join(root, file), { force: true });
        }
    }
}
