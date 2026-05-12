import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type PackFile = {
	path: string;
};

type PackResult = {
	files: PackFile[];
};

describe("npm package hygiene", () => {
	it("publishes the CLI build without repo-local state or test fixtures", () => {
		execFileSync("npm", ["run", "build", "--silent"], {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		const output = execFileSync(
			"npm",
			["pack", "--dry-run", "--json", "--ignore-scripts"],
			{
				cwd: process.cwd(),
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const [packResult] = JSON.parse(output) as PackResult[];
		const paths = packResult.files.map((file) => file.path);

		expect(paths).toContain("dist/cli/main.js");
		expect(paths).toContain("package.json");

		expect(paths.some((path) => path.startsWith(".contexttrail/"))).toBe(false);
		expect(paths.some((path) => path.startsWith(".claude/"))).toBe(false);
		expect(paths.some((path) => path.startsWith("tests/"))).toBe(false);
		expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
		expect(paths.some((path) => path.startsWith("dist/eval/"))).toBe(false);
		expect(paths.some((path) => path.endsWith(".js.map"))).toBe(false);
		expect(paths.some((path) => path === ".mcp.json")).toBe(false);
	});
});
